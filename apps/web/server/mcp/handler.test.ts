import { describe, expect, it, vi } from "vitest";
import { handleMcpRequest } from "./handler";

// Tokens map straight to user ids; the DB is never touched by initialize.
vi.mock("@/lib/bearer", () => ({
	verifyBearer: async (token: string) =>
		token.startsWith("user-") ? token : null,
}));
vi.mock("@feedreader/db/client", () => ({ db: {} }));

const initialize = {
	jsonrpc: "2.0",
	id: 1,
	method: "initialize",
	params: {
		protocolVersion: "2025-03-26",
		capabilities: {},
		clientInfo: { name: "test", version: "0" },
	},
};

function post(token: string, body: unknown, sessionId?: string) {
	return handleMcpRequest(
		new Request("http://localhost/api/mcp", {
			method: "POST",
			headers: {
				authorization: `Bearer ${token}`,
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
				...(sessionId ? { "mcp-session-id": sessionId } : {}),
			},
			body: JSON.stringify(body),
		}),
	);
}

describe("MCP sessions", () => {
	it("binds a session to the user who opened it", async () => {
		const res = await post("user-a", initialize);
		expect(res.status).toBe(200);
		const sessionId = res.headers.get("mcp-session-id");
		expect(sessionId).toBeTruthy();
		await res.body?.cancel();

		const ping = { jsonrpc: "2.0", id: 2, method: "ping" };
		const foreign = await post("user-b", ping, sessionId!);
		expect(foreign.status).toBe(403);

		const own = await post("user-a", ping, sessionId!);
		expect(own.status).toBe(200);
		await own.body?.cancel();

		const del = await handleMcpRequest(
			new Request("http://localhost/api/mcp", {
				method: "DELETE",
				headers: {
					authorization: "Bearer user-b",
					"mcp-session-id": sessionId!,
				},
			}),
		);
		expect(del.status).toBe(403);
	});

	it("rejects unknown sessions and missing tokens", async () => {
		const anon = await handleMcpRequest(
			new Request("http://localhost/api/mcp", { method: "POST" }),
		);
		expect(anon.status).toBe(401);
		expect(anon.headers.get("www-authenticate")).toContain("resource_metadata");
		const unknown = await post(
			"user-a",
			{ jsonrpc: "2.0", id: 1, method: "ping" },
			"nope",
		);
		expect(unknown.status).toBe(400);
	});
});
