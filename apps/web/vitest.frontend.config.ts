import { defineConfig } from "vitest/config";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		globals: false,
		environment: "happy-dom",
		setupFiles: ["./tests/frontend-setup.ts"],
		include: [
			"components/**/*.test.tsx",
			"app/**/*.test.tsx",
			"hooks/**/*.test.tsx",
			"lib/**/*.test.tsx",
		],
		// Exclude backend tests (they use node + real Postgres)
		exclude: ["tests/**/*.test.ts", "server/**/*.test.ts", "node_modules/**"],
		testTimeout: 10_000,
	},
});
