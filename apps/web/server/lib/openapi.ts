import { contract } from "@feedreader/api";
import { OpenAPIGenerator } from "@orpc/openapi";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";

/** Public base path of the REST (OpenAPI) flavour of the oRPC router. */
export const OPENAPI_PREFIX = "/api/v1";

const generator = new OpenAPIGenerator({
	schemaConverters: [new ZodToJsonSchemaConverter()],
});

/**
 * Builds the OpenAPI document from the `@feedreader/api` contract. Only the
 * contract is described (inputs/outputs), so the spec carries nothing
 * user-specific and can be served publicly.
 */
export function generateOpenApiSpec(appUrl: string) {
	return generator.generate(contract, {
		info: { title: "Feed Reader API", version: "1.0.0" },
		servers: [{ url: `${appUrl}${OPENAPI_PREFIX}` }],
		security: [{ bearerAuth: [] }],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: "http",
					scheme: "bearer",
					description:
						"An `app_` API key (Settings → API keys) or an OAuth access token.",
				},
			},
		},
	});
}

/**
 * Pinned Scalar bundle. The hash is the sha384 of that exact file — bump both
 * together (`curl -sL $SCALAR_SRC | openssl dgst -sha384 -binary | openssl base64 -A`).
 * The CDN host is allowed by the /api/reference CSP in vercel.json.
 */
export const SCALAR_SRC =
	"https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.66.1/dist/browser/standalone.js";
export const SCALAR_INTEGRITY =
	"sha384-RkhHYpdjsrJH9sH8RmczPchxNiHEhmW300QwMB/8yg6feduTZu9FBN4W0DJnp50Z";

/** Scalar API Reference page pointing at the spec URL. */
export function renderApiReferenceHtml(specUrl: string): string {
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Feed Reader API</title>
</head>
<body>
<div id="app"></div>
<script src="${SCALAR_SRC}" integrity="${SCALAR_INTEGRITY}" crossorigin="anonymous"></script>
<script>
Scalar.createApiReference("#app", { url: ${JSON.stringify(specUrl)} });
</script>
</body>
</html>`;
}
