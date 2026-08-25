import { onError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/lib/axiom/server";
import { router } from "@/server/routes";

const handler = new RPCHandler(router, {
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

					// Flush logs before the serverless function terminates
					await logger.flush();

					if (response) {
						return response;
					}

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
