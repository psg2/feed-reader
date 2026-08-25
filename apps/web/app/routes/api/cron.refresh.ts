import { timingSafeEqual } from "node:crypto";
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@feedreader/db/client";
import { env } from "@/lib/env";
import { refreshAllUsers } from "@/server/usecases/reader";

function authorized(header: string | null, secret: string | undefined) {
	if (!secret || !header) return false;
	const a = Buffer.from(header);
	const b = Buffer.from(`Bearer ${secret}`);
	return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Vercel cron target: refreshes every enabled feed of every user, skipping
 * feeds fetched in the last 10 minutes (`?force=1` fetches all).
 * Vercel sends `Authorization: Bearer ${CRON_SECRET}` when the env var is set.
 */
async function handle({ request }: { request: Request }) {
	if (!authorized(request.headers.get("authorization"), env.CRON_SECRET)) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	const force = new URL(request.url).searchParams.get("force") === "1";
	const summary = await refreshAllUsers(db, fetch, { force });
	console.log("[cron/refresh]", summary);
	return Response.json(summary);
}

export const Route = createFileRoute("/api/cron/refresh")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
