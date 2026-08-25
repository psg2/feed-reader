import { createFileRoute } from "@tanstack/react-router";
import { getAppUrl } from "@/lib/env";

/**
 * OAuth 2.0 Protected Resource Metadata (RFC 9728) for the MCP endpoint.
 *
 * MCP clients (Claude Code, Claude.ai) start OAuth discovery here: they fetch
 * /.well-known/oauth-protected-resource/api/mcp (path-suffix form) or the
 * bare /.well-known/oauth-protected-resource, read authorization_servers and
 * proceed to BetterAuth's metadata at /api/auth/.well-known/….
 *
 * The splat matches both the bare path and any suffix, so one route covers
 * every resource path a client may append.
 */
function metadata() {
	const base = getAppUrl();
	return Response.json(
		{
			resource: `${base}/api/mcp`,
			authorization_servers: [`${base}/api/auth`],
			bearer_methods_supported: ["header"],
			scopes_supported: ["openid", "profile", "email", "offline_access"],
			resource_name: "Feed Reader",
		},
		{ headers: { "Cache-Control": "public, max-age=3600" } },
	);
}

export const Route = createFileRoute("/.well-known/oauth-protected-resource/$")(
	{
		server: {
			handlers: {
				GET: metadata,
			},
		},
	},
);
