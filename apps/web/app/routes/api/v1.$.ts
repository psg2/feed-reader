import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { onError } from "@orpc/server";
import { createFileRoute } from "@tanstack/react-router";
import { logger } from "@/lib/axiom/server";
import { OPENAPI_PREFIX } from "@/server/lib/openapi";
import { router } from "@/server/routes";

/**
 * REST flavour of the oRPC router, matching the paths documented at
 * `/api/openapi.json`. Same handlers and auth as `/api/rpc`.
 */
const handler = new OpenAPIHandler(router, {
	interceptors: [
		onError((error) => {
			console.error("[oRPC/openapi]", error);
		}),
	],
});

export const Route = createFileRoute("/api/v1/$")({
	server: {
		handlers: {
			ANY: async ({ request }: { request: Request }) => {
				try {
					const { response } = await handler.handle(request, {
						prefix: OPENAPI_PREFIX,
						context: {},
					});
					await logger.flush();
					return response ?? new Response("Not found", { status: 404 });
				} catch (error) {
					console.error("[oRPC/openapi Handler Error]", error);
					await logger.flush();
					return new Response("Internal server error", { status: 500 });
				}
			},
		},
	},
});
