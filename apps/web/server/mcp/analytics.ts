/**
 * PostHog MCP Analytics: tool calls, agent intent, latency, errors and the
 * capabilities agents asked for but the server lacks (`get_more_tools`).
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
		reportMissing: true,
		// Its schema tells agents not to call tools in parallel until the first
		// reply arrives; the user id already ties a client's calls together.
		enableConversationId: false,
		serverBuild: process.env.VERCEL_GIT_COMMIT_SHA,
		// Tool arguments and results are the user's own records; keep the shape
		// of the call (tool, intent, latency, error) and leave the data out.
		beforeSend: (event) => {
			delete event.properties.$mcp_parameters;
			delete event.properties.$mcp_response;
			return event;
		},
	});
}

/**
 * Flushes queued events once the response body has been fully sent: a tool
 * result may still be streaming when the handler returns, and a serverless
 * function never sees SIGTERM to flush on.
 */
export function flushMcpAnalyticsAfter(response: Response): Response {
	const client = posthog;
	if (!client || !response.body) return response;
	const body = response.body.pipeThrough(
		new TransformStream({
			flush() {
				waitUntil(client.flush());
			},
		}),
	);
	return new Response(body, response);
}
