/**
 * PostHog MCP Analytics: tool calls, agent intent, latency, errors and the
 * feedback agents send through `send_feedback`, above all capabilities the
 * server lacks.
 * Off when `VITE_PUBLIC_POSTHOG_KEY` is unset.
 */

import { instrument } from "@posthog/mcp";
import { waitUntil } from "@vercel/functions";
import { PostHog } from "posthog-node";
import { env } from "@/lib/env";

// The browser's project token, so MCP calls land on the same person the web
// app identifies by user id.
const posthog = env.VITE_PUBLIC_POSTHOG_KEY
	? new PostHog(env.VITE_PUBLIC_POSTHOG_KEY, {
			host: env.VITE_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com",
		})
	: null;

/** Call on a fresh server before registering tools. */
export function instrumentMcpServer(server: unknown, userId: string): void {
	if (!posthog) return;
	instrument(server, posthog, {
		identify: { distinctId: userId },
		collectFeedback: true,
		// Its schema tells agents not to call tools in parallel until the first
		// reply arrives; the user id already ties a client's calls together.
		enableConversationId: false,
		serverBuild: process.env.VERCEL_GIT_COMMIT_SHA,
		// Tool arguments, results and error messages (a failed query quotes its
		// SQL params) are the user's own records; keep the shape of the call
		// (tool, intent, latency, error type) and leave the data out.
		enableExceptionAutocapture: false,
		beforeSend: (event) => {
			delete event.properties.$mcp_parameters;
			delete event.properties.$mcp_response;
			delete event.properties.$mcp_error_message;
			// send_feedback's schema asks for exact parameter values and error
			// text in these two fields; the summary and suggestion are enough.
			delete event.properties.$mcp_feedback_details;
			delete event.properties.$mcp_feedback_friction_points;
			// The SDK also appends details to a feedback event's intent.
			if ("$mcp_feedback_type" in event.properties) {
				event.properties.$mcp_intent = event.properties.$mcp_feedback_summary;
			}
			return event;
		},
	});
}

/**
 * Flushes queued events once the response body is done, sent or cancelled by
 * the client: a tool result may still be streaming when the handler returns,
 * and a serverless function never sees SIGTERM to flush on.
 */
export function flushMcpAnalyticsAfter(response: Response): Response {
	const client = posthog;
	if (!client || !response.body) return response;
	const flush = () => waitUntil(client.flush());
	// `cancel` (client went away mid-stream) is in the Streams spec and in
	// Node, but not yet in TypeScript's Transformer type.
	const transformer: Transformer & { cancel: () => void } = {
		flush,
		cancel: flush,
	};
	const body = response.body.pipeThrough(new TransformStream(transformer));
	return new Response(body, response);
}
