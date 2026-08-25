/**
 * MCP request handler for TanStack Start.
 *
 * Uses the Streamable HTTP transport (Web Standards) — no Node.js adapter needed.
 * Tools call usecases directly — no HTTP round-trip to oRPC.
 *
 * Auth: bearer tokens (OAuth access tokens or API keys) via lib/bearer.
 * MCP clients authenticate via OIDC (dynamic client registration + PKCE).
 * API keys are also supported for scripts/automation.
 */

import { randomUUID } from "node:crypto";
import { db } from "@feedreader/db/client";
import { verifyBearer } from "@/lib/bearer";
import { getAppUrl } from "@/lib/env";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerPrompts } from "./prompts";
import { registerAllTools } from "./tools/index";
import type { McpContext } from "./types";

// ── Session tracking ──────────────────────────────────────────────────────

interface Session {
	transport: WebStandardStreamableHTTPServerTransport;
	/** The user the session was initialised for; other tokens may not reuse it. */
	userId: string;
	lastSeen: number;
}

const SESSION_IDLE_MS = 30 * 60_000;
const MAX_SESSIONS = 500;

const sessions = new Map<string, Session>();

async function dropSession(id: string) {
	const session = sessions.get(id);
	sessions.delete(id);
	await session?.transport.close().catch(() => {});
}

/** Idle sessions go first; if still over the cap, the least recently seen. */
async function evictSessions() {
	const now = Date.now();
	for (const [id, s] of sessions) {
		if (now - s.lastSeen > SESSION_IDLE_MS) await dropSession(id);
	}
	if (sessions.size < MAX_SESSIONS) return;
	const oldest = [...sessions.entries()].sort(
		(a, b) => a[1].lastSeen - b[1].lastSeen,
	);
	for (const [id] of oldest.slice(0, sessions.size - MAX_SESSIONS + 1)) {
		await dropSession(id);
	}
}

/** Looks up a session for this user, touching it; a foreign session is reported as such. */
function claimSession(
	sessionId: string | null,
	userId: string,
): Session | "forbidden" | null {
	const session = sessionId ? sessions.get(sessionId) : undefined;
	if (!session) return null;
	if (session.userId !== userId) return "forbidden";
	session.lastSeen = Date.now();
	return session;
}

// ── Server factory ────────────────────────────────────────────────────────

function createMcpServer(getCtx: () => McpContext): McpServer {
	const server = new McpServer({
		name: "feedreader",
		version: "1.0.0",
	});

	registerAllTools(server, getCtx);
	registerPrompts(server);

	return server;
}

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
	const method = request.method;

	// ── Auth ──────────────────────────────────────────────────────────────
	const authHeader = request.headers.get("authorization");
	if (!authHeader?.startsWith("Bearer ")) {
		return unauthorized("Missing bearer token");
	}

	const token = authHeader.slice(7).trim();
	const userId = await verifyBearer(token);
	if (!userId) {
		return unauthorized("Invalid or expired token");
	}

	const getCtx = (): McpContext => ({ db, userId });
	const sessionId = request.headers.get("mcp-session-id");
	await evictSessions();
	const session = claimSession(sessionId, userId);
	if (session === "forbidden") {
		return Response.json(
			{ error: "Session belongs to another user" },
			{ status: 403 },
		);
	}

	// ── DELETE: close session ────────────────────────────────────────────
	if (method === "DELETE") {
		if (!session || !sessionId) {
			return Response.json(
				{ error: "Invalid or missing session ID" },
				{ status: 400 },
			);
		}
		await dropSession(sessionId);
		return new Response(null, { status: 204 });
	}

	// ── GET: SSE stream ──────────────────────────────────────────────────
	if (method === "GET") {
		if (!session) {
			return Response.json(
				{ error: "Invalid or missing session ID" },
				{ status: 400 },
			);
		}
		return session.transport.handleRequest(request);
	}

	// ── POST: initialize or tool call ────────────────────────────────────
	if (method === "POST") {
		// Existing session
		if (session) return session.transport.handleRequest(request);

		// New session — must be initialize
		const body = await request.json();
		if (!isInitializeRequest(body)) {
			return Response.json(
				{
					jsonrpc: "2.0",
					error: {
						code: -32000,
						message: "Bad Request: No valid session ID provided",
					},
					id: null,
				},
				{ status: 400 },
			);
		}

		const transport = new WebStandardStreamableHTTPServerTransport({
			sessionIdGenerator: () => randomUUID(),
			onsessioninitialized: (id) => {
				sessions.set(id, { transport, userId, lastSeen: Date.now() });
			},
			onsessionclosed: (id) => {
				sessions.delete(id);
			},
		});

		const server = createMcpServer(getCtx);
		await server.connect(transport);

		return transport.handleRequest(request, { parsedBody: body });
	}

	return new Response("Method not allowed", { status: 405 });
}
