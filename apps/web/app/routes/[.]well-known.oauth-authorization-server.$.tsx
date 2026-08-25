import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";
import { getAppUrl } from "@/lib/env";

/**
 * Root-level OAuth Authorization Server Metadata (RFC 8414).
 *
 * Our issuer is `<origin>/api/auth`, so path-insertion discovery clients
 * request /.well-known/oauth-authorization-server/api/auth (and some request
 * the bare path). BetterAuth serves the real document under
 * /api/auth/.well-known/… — this route answers the root-level aliases by
 * invoking the auth handler directly.
 */
async function metadata() {
	const base = getAppUrl();
	return auth.handler(
		new Request(`${base}/api/auth/.well-known/oauth-authorization-server`),
	);
}

export const Route = createFileRoute(
	"/.well-known/oauth-authorization-server/$",
)({
	server: {
		handlers: {
			GET: metadata,
		},
	},
});
