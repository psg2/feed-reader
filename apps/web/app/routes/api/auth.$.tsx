import { createFileRoute } from "@tanstack/react-router";
import { auth } from "@/lib/auth";

/**
 * Catch-all BetterAuth API route.
 *
 * Handles all `/api/auth/*` requests: sign-in, sign-up, sign-out,
 * session validation, OAuth callbacks, admin endpoints, etc.
 */
async function handleAll(ctx: { request: Request }): Promise<Response> {
	return auth.handler(ctx.request);
}

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			ANY: handleAll,
		},
	},
});
