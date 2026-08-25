import { contract } from "@feedreader/api";
import { implement, ORPCError } from "@orpc/server";
import { getRequest } from "@tanstack/react-start/server";
import { db } from "@feedreader/db/client";
import { auth } from "@/lib/auth";
import { verifyBearer } from "@/lib/bearer";
import { env } from "@/lib/env";
import { isAdminUserId, parseAdminEmails } from "@/server/usecases/admin";

/**
 * Contract implementer — enforces that every route handler matches
 * the input/output schemas defined in @feedreader/api.
 *
 * Includes a global error-sanitization middleware that catches raw Errors
 * from usecases and converts them to typed ORPCErrors. This prevents
 * internal error messages from leaking to the client in production.
 */
const raw = implement(contract);

// ── Error sanitization middleware ─────────────────────────────────────────

/**
 * Map common usecase error patterns to appropriate ORPCError codes.
 * The original message is logged server-side but NOT sent to the client
 * for unrecognized errors — a generic message is used instead.
 */
function toORPCError(err: unknown): ORPCError<string, unknown> {
	// Already an ORPCError — pass through as-is
	if (err instanceof ORPCError) return err;

	const message = err instanceof Error ? err.message : String(err);

	// Pattern-match common usecase errors to HTTP semantics
	if (/\b(forbidden|no access|cannot "\w+" on)\b/i.test(message))
		return new ORPCError("FORBIDDEN");

	if (/\b(not found)\b/i.test(message)) return new ORPCError("NOT_FOUND");

	if (/\b(unauthorized)\b/i.test(message)) return new ORPCError("UNAUTHORIZED");

	if (/\b(conflict|duplicate|already exists)\b/i.test(message))
		return new ORPCError("CONFLICT", { message });

	// Default: log full error server-side, return generic to client
	return new ORPCError("INTERNAL_SERVER_ERROR");
}

export const pub = raw.use(async ({ next }) => {
	try {
		return await next();
	} catch (err) {
		// ORPCErrors pass through untouched
		if (err instanceof ORPCError) throw err;

		// Log the real error server-side for debugging
		console.error("[orpc:error]", err);

		throw toORPCError(err);
	}
});

/**
 * Authenticated implementer — resolves BetterAuth session OR API key to user UUID.
 *
 * Two auth paths:
 * 1. Browser sessions — cookie-based, validated via `auth.api.getSession()`
 * 2. Bearer tokens — `app_` API keys or OAuth access tokens (see lib/bearer)
 *
 * Context provides `userId` (UUID) for all downstream usecases/repos,
 * keeping the external auth provider as an implementation detail.
 */
export const authed = pub.use(async ({ next }) => {
	const request = getRequest();

	// Bearer path: `app_` API keys (scripts) or OAuth access tokens
	// (macOS app, MCP clients)
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		const userId = await verifyBearer(authHeader.slice(7).trim());
		if (!userId) throw new ORPCError("UNAUTHORIZED");
		return next({ context: { userId } });
	}

	// Session path: browser requests use cookie-based sessions
	const session = await auth.api.getSession({
		headers: request.headers,
	});

	if (!session?.user) {
		throw new ORPCError("UNAUTHORIZED");
	}

	return next({ context: { userId: session.user.id } });
});

/**
 * Admin-only implementer — `authed` plus an instance-admin check
 * (ADMIN_EMAILS, or the first account; see usecases/admin). Answers 403 to
 * everyone else, API keys and OAuth tokens included.
 */
export const admin = authed.use(async ({ context, next }) => {
	const ok = await isAdminUserId(
		db,
		context.userId,
		parseAdminEmails(env.ADMIN_EMAILS),
	);
	if (!ok) throw new ORPCError("FORBIDDEN");
	return next();
});
