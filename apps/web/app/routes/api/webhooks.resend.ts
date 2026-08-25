import { createFileRoute } from "@tanstack/react-router";
import { db } from "@feedreader/db/client";
import { env } from "@/lib/env";
import { verifySvixSignature } from "@/server/lib/svix";
import {
	fetchAttachment,
	fetchReceivedEmail,
	ingestReceivedEmail,
	parseAllowedSenders,
} from "@/server/usecases/inbound";

/**
 * Resend `email.received` webhook: the payload only carries metadata, so the
 * body is fetched from the Received Emails API and stored as an item of the
 * sender's feed. Other event types are acknowledged and ignored.
 */
async function handle({ request }: { request: Request }) {
	if (!env.RESEND_WEBHOOK_SECRET || !env.RESEND_API_KEY) {
		return Response.json(
			{ error: "Inbound e-mail not configured" },
			{ status: 503 },
		);
	}
	const body = await request.text();
	const valid = verifySvixSignature(
		env.RESEND_WEBHOOK_SECRET,
		{
			id: request.headers.get("svix-id"),
			timestamp: request.headers.get("svix-timestamp"),
			signature: request.headers.get("svix-signature"),
		},
		body,
	);
	if (!valid)
		return Response.json({ error: "Invalid signature" }, { status: 401 });

	const event = JSON.parse(body) as {
		type?: string;
		data?: { email_id?: string };
	};
	if (event.type !== "email.received" || !event.data?.email_id) {
		return Response.json({ status: "ignored" });
	}
	const apiKey = env.RESEND_API_KEY;
	const email = await fetchReceivedEmail(apiKey, event.data.email_id);
	const result = await ingestReceivedEmail(db, email, {
		inboundDomain: env.INBOUND_EMAIL_DOMAIN,
		allowedSenders: parseAllowedSenders(env.INBOUND_ALLOWED_SENDERS),
		downloadAttachment: (attachmentId) =>
			fetchAttachment(apiKey, email.id, attachmentId),
	});
	console.log("[webhooks/resend]", event.data.email_id, result);
	return Response.json(result);
}

export const Route = createFileRoute("/api/webhooks/resend")({
	server: {
		handlers: {
			POST: handle,
		},
	},
});
