import { describe, expect, it } from "vitest";
import { generateOpenApiSpec, renderApiReferenceHtml } from "./openapi";

describe("openapi", () => {
	it("generates the spec from the contract", async () => {
		const spec = await generateOpenApiSpec("https://reader.example");
		expect(spec.info.title).toBe("Feed Reader API");
		expect(spec.servers?.[0]?.url).toBe("https://reader.example/api/v1");
		expect(spec.paths?.["/reader/feeds"]?.get).toBeDefined();
		expect(spec.paths?.["/reader/items/list"]?.post).toBeDefined();
		expect(spec.paths?.["/reader/items/{itemId}"]?.patch).toBeDefined();
		expect(spec.paths?.["/admin/invites"]?.post).toBeDefined();
		expect(spec.paths?.["/admin/users/{id}"]?.delete).toBeDefined();
		expect(spec.components?.securitySchemes?.bearerAuth).toMatchObject({
			type: "http",
			scheme: "bearer",
		});
		expect(spec.security).toEqual([{ bearerAuth: [] }]);
	});

	it("renders a Scalar page pointing at the spec", () => {
		const html = renderApiReferenceHtml("/api/openapi.json");
		expect(html).toContain('"/api/openapi.json"');
		expect(html).toContain("@scalar/api-reference@");
		expect(html).toMatch(/integrity="sha384-[A-Za-z0-9+/=]+"/);
		expect(html).toContain('crossorigin="anonymous"');
	});
});
