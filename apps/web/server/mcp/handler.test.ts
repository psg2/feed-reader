import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "./handler";

// Tokens map straight to user ids; listing tools and prompts never touches the DB.
vi.mock("@/lib/bearer", () => ({
	verifyBearer: async (token: string) =>
		token.startsWith("user-") ? token : null,
}));
vi.mock("@feedreader/db/client", () => ({ db: {} }));

const LEGACY_VERSION = "2025-03-26";

// 2026-07-28 drops the initialize handshake: every request carries its
// protocol version and client info in `_meta`.
const MODERN_META = {
	"io.modelcontextprotocol/protocolVersion": "2026-07-28",
	"io.modelcontextprotocol/clientCapabilities": {},
	"io.modelcontextprotocol/clientInfo": { name: "test", version: "0" },
};

function post(
	body: unknown,
	headers: Record<string, string> = {},
	token = "user-a",
) {
	return handleMcpRequest(
		new Request("http://localhost/api/mcp", {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...headers,
			},
			body: JSON.stringify(body),
		}),
	);
}

function postModern(method: string, params: object = {}) {
	return post(
		{
			jsonrpc: "2.0",
			id: 1,
			method,
			params: { _meta: MODERN_META, ...params },
		},
		{
			"mcp-protocol-version":
				MODERN_META["io.modelcontextprotocol/protocolVersion"],
			"mcp-method": method,
		},
	);
}

/** The body; fails when the server is still holding it open after `ms`. */
async function bodyWithin(res: Response, ms: number): Promise<string> {
	return Promise.race([
		res.text(),
		new Promise<never>((_, fail) =>
			setTimeout(() => fail(new Error(`body still open after ${ms} ms`)), ms),
		),
	]);
}

/** A JSON-RPC result from either a JSON or a single-event SSE body. */
function rpcResult(body: string) {
	const json = body.startsWith("{")
		? body
		: (body
				.split("\n")
				.find((line) => line.startsWith("data: "))
				?.slice(6) ?? "{}");
	return JSON.parse(json);
}

describe("MCP handler", () => {
	it("serves a client on the 2026-07-28 protocol revision", async () => {
		const res = await postModern("tools/list");

		expect(res.status).toBe(200);
		const { result } = rpcResult(await bodyWithin(res, 1000));
		expect(result.tools.map((t: { name: string }) => t.name)).toContain(
			"list_items",
		);
	});

	it("tells clients nothing changes, so they have no reason to subscribe", async () => {
		const res = await postModern("server/discover");
		const { result } = rpcResult(await bodyWithin(res, 1000));

		expect(result.capabilities.tools?.listChanged).toBe(false);
		expect(result.capabilities.prompts?.listChanged ?? false).toBe(false);
	});

	it("refuses a subscription at once instead of holding it until the function times out", async () => {
		const res = await postModern("subscriptions/listen", {
			notifications: { toolsListChanged: true },
		});

		expect(rpcResult(await bodyWithin(res, 1000))).toHaveProperty("error");
	});

	it("lists the tools with their input schemas", async () => {
		const res = await postModern("tools/list");
		const { result } = rpcResult(await bodyWithin(res, 1000));
		const addNote = result.tools.find(
			(t: { name: string }) => t.name === "add_note",
		);

		expect(addNote.inputSchema.required).toEqual(["id", "notes"]);
	});

	it("still serves 2025-era clients without a session", async () => {
		const init = await post(
			{
				jsonrpc: "2.0",
				id: 1,
				method: "initialize",
				params: {
					protocolVersion: LEGACY_VERSION,
					capabilities: {},
					clientInfo: { name: "test", version: "0" },
				},
			},
			{ "mcp-protocol-version": LEGACY_VERSION },
		);
		expect(init.status).toBe(200);
		expect(init.headers.get("mcp-session-id")).toBeNull();
		const { result: initResult } = rpcResult(await bodyWithin(init, 1000));
		expect(initResult.protocolVersion).toBe(LEGACY_VERSION);

		const list = await post(
			{ jsonrpc: "2.0", id: 2, method: "tools/list" },
			{ "mcp-protocol-version": LEGACY_VERSION },
		);
		expect(list.status).toBe(200);
		const { result } = rpcResult(await bodyWithin(list, 1000));
		expect(result.tools.length).toBeGreaterThan(0);
	});

	it("rejects missing and invalid tokens with the OAuth challenge", async () => {
		const anon = await handleMcpRequest(
			new Request("http://localhost/api/mcp", { method: "POST" }),
		);
		expect(anon.status).toBe(401);
		expect(anon.headers.get("www-authenticate")).toContain("resource_metadata");

		const invalid = await post(
			{ jsonrpc: "2.0", id: 1, method: "ping" },
			{},
			"bogus",
		);
		expect(invalid.status).toBe(401);
		expect(invalid.headers.get("www-authenticate")).toContain(
			"resource_metadata",
		);
	});
});
