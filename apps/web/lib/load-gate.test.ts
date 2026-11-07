import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { loadGate } from "./load-gate";

function gate(answers: Array<string | null>) {
	let calls = 0;
	return {
		query: {
			queryKey: ["gate", "test"],
			queryFn: async () => answers[calls++] ?? null,
			staleTime: 60_000,
		},
		calls: () => calls,
	};
}

describe("loadGate", () => {
	it("answers a navigation from the cache without waiting for the server", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["gate", "test"], "user-1");
		const { query, calls } = gate(["user-2"]);

		await expect(loadGate(queryClient, query)).resolves.toBe("user-1");
		expect(calls()).toBe(0);
	});

	it("asks again when the cached answer is signed out, so a fresh sign-in gets through", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["gate", "test"], null);
		const { query } = gate(["user-1"]);

		await expect(loadGate(queryClient, query)).resolves.toBe("user-1");
	});

	it("refreshes a stale answer in the background", async () => {
		const queryClient = new QueryClient();
		queryClient.setQueryData(["gate", "test"], "user-1", {
			updatedAt: Date.now() - 120_000,
		});
		const { query } = gate([null]);

		await expect(loadGate(queryClient, query)).resolves.toBe("user-1");
		await queryClient.getQueryCache().find({ queryKey: ["gate", "test"] })
			?.promise;
		expect(queryClient.getQueryData(["gate", "test"])).toBeNull();
	});
});
