import { createFileRoute } from "@tanstack/react-router";
import { db } from "@feedreader/db/client";
import { auth } from "@/lib/auth";
import { verifyBearer } from "@/lib/bearer";
import { exportOpml } from "@/server/usecases/reader";

/** Same two auth paths as the oRPC `authed` middleware: session cookie or Bearer. */
async function resolveUserId(request: Request): Promise<string | null> {
	const authHeader = request.headers.get("authorization");
	if (authHeader?.startsWith("Bearer ")) {
		return verifyBearer(authHeader.slice(7).trim());
	}
	const session = await auth.api.getSession({ headers: request.headers });
	return session?.user?.id ?? null;
}

async function handle({ request }: { request: Request }) {
	const userId = await resolveUserId(request);
	if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });
	const xml = await exportOpml(db, userId);
	return new Response(xml, {
		headers: {
			"Content-Type": "application/xml; charset=utf-8",
			"Content-Disposition": 'attachment; filename="feedreader.opml"',
			"Cache-Control": "no-store",
		},
	});
}

export const Route = createFileRoute("/api/opml")({
	server: {
		handlers: {
			GET: handle,
		},
	},
});
