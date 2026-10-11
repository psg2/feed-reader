/**
 * MCP request handler for TanStack Start.
 *
 * Serves the 2026-07-28 protocol revision (stateless core: no initialize
 * handshake, no sessions; every request carries its version in `_meta`) via
 * the SDK v2 `createMcpHandler`, which also answers 2025-era clients with the
 * per-request stateless fallback. Nothing is kept between requests, so any
 * serverless instance can serve any request.
 *
 * Tools call usecases directly — no HTTP round-trip to oRPC.
 *
 * Auth: bearer tokens (OAuth access tokens or API keys) via lib/bearer,
 * verified before the request reaches the SDK (which performs no token
 * verification itself). MCP clients authenticate via OIDC (Client ID Metadata
 * Documents + PKCE). API keys are also supported for scripts/automation.
 */

import { db } from "@feedreader/db/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { verifyBearer } from "@/lib/bearer";
import { getAppUrl } from "@/lib/env";
import { flushMcpAnalyticsAfter, instrumentMcpServer } from "./analytics";
import { registerPrompts } from "./prompts";
import { registerAllTools } from "./tools/index";
import type { McpContext } from "./types";

// ── Server factory ────────────────────────────────────────────────────────

// One factory backs both protocol eras; each request gets a fresh server
// bound to the user resolved from its bearer token.
//
// No `subscriptions/listen`: that stream stays open until the client leaves,
// and on a serverless function nothing ever pushes on it, so each one runs
// into the platform timeout (300 s on Vercel). The tool list is fixed, so
// nothing is advertised as changing and a listen that still arrives is
// refused at once instead of held.
export const mcp = createMcpHandler(
	({ authInfo }) => {
		const userId = authInfo?.extra?.userId;
		if (typeof userId !== "string")
			throw new Error("Unauthenticated MCP request");
		const getCtx = (): McpContext => ({ db, userId });

		const server = new McpServer(
			{ name: "feedreader", version: "1.0.0" },
			{
				capabilities: {
					tools: { listChanged: false },
					prompts: { listChanged: false },
				},
			},
		);
		instrumentMcpServer(server, userId);
		registerAllTools(server, getCtx);
		registerPrompts(server);
		return server;
	},
	{ maxSubscriptions: 0 },
);

// ── Request handler ───────────────────────────────────────────────────────

/**
 * 401 with the WWW-Authenticate challenge from RFC 9728: points OAuth-capable
 * MCP clients at the protected-resource metadata so they can discover the
 * authorization server and start the flow.
 */
function unauthorized(message: string): Response {
	const origin = getAppUrl();
	return Response.json(
		{ error: message },
		{
			status: 401,
			headers: {
				"WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp"`,
			},
		},
	);
}

export async function handleMcpRequest(request: Request): Promise<Response> {
	const authHeader = request.headers.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return unauthorized("Missing bearer token");
	}

	const token = authHeader.slice(7).trim();
	const userId = await verifyBearer(token);
	if (!userId) {
		return unauthorized("Invalid or expired token");
	}

	return flushMcpAnalyticsAfter(
		await mcp.fetch(request, {
			authInfo: { token, clientId: "", scopes: [], extra: { userId } },
		}),
	);
}
