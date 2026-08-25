import { createFileRoute } from "@tanstack/react-router";
import { getAppUrl } from "@/lib/env";
import { generateOpenApiSpec } from "@/server/lib/openapi";

/**
 * OpenAPI document for the REST flavour of the API (`/api/v1`). Public: it is
 * derived from the contract alone and contains no user data.
 */
export const Route = createFileRoute("/api/openapi.json")({
	server: {
		handlers: {
			GET: async () => {
				const spec = await generateOpenApiSpec(getAppUrl());
				return Response.json(spec, {
					headers: { "cache-control": "public, max-age=300" },
				});
			},
		},
	},
});
