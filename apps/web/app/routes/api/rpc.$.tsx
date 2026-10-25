import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { BatchHandlerPlugin } from "@orpc/server/plugins";
import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/lib/axiom/server";
import { router } from "@/server/routes";

const handler = new RPCHandler(router, {
	plugins: [new BatchHandlerPlugin()],
	interceptors: [
		onError((error) => {
			console.error("[oRPC]", error);
		}),
	],
	clientInterceptors: [
		async ({ path, next }) => {
			const start = performance.now();
			try {
				return await next();
			} finally {
				logger.info("rpc.procedure", {
					procedure: path.join("."),
					duration_ms: Math.round(performance.now() - start),
				});
			}
		},
	],
});

export const Route = createFileRoute("/api/rpc/$")({
	server: {
		handlers: {
			ANY: async ({ request }: { request: Request }) => {
				try {
					const { response } = await handler.handle(request, {
						prefix: "/api/rpc",
						context: {},
					});

					if (response) {
						return await sendThenFlushLogs(response);
					}

					await logger.flush();
					return new Response("Not found", { status: 404 });
				} catch (error) {
					console.error("[oRPC Handler Error]", error);
					await logger.flush();
					return new Response("Internal server error", { status: 500 });
				}
			},
		},
	},
});

/**
 * A batch streams each procedure's answer as it lands, so the logs are flushed
 * once the body is sent, not when the response starts.
 */
async function sendThenFlushLogs(response: Response): Promise<Response> {
	if (!response.body) {
		await logger.flush();
		return response;
	}
	const body = response.body.pipeThrough(
		new TransformStream({ flush: () => logger.flush() }),
	);
	return new Response(body, response);
}
