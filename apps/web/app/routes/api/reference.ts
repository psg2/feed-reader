import { createFileRoute } from "@tanstack/react-router";
import { renderApiReferenceHtml } from "@/server/lib/openapi";

/** Scalar API Reference UI for `/api/openapi.json`. Public, like the spec. */
export const Route = createFileRoute("/api/reference")({
	server: {
		handlers: {
			GET: async () =>
				new Response(renderApiReferenceHtml("/api/openapi.json"), {
					headers: { "content-type": "text/html; charset=utf-8" },
				}),
		},
	},
});
