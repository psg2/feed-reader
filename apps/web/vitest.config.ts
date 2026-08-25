import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

const repoRoot = resolve(__dirname, "../..");

/**
 * Minimal dotenv parser for `.env.docker`: `KEY=value` lines, `#` comments,
 * optional single/double quotes. Vite's loadEnv only reads `.env`,
 * `.env.local` and `.env.<mode>*`, so the file `pnpm deps:up` writes
 * (POSTGRES_URL / TEST_DATABASE_URL with Docker-assigned ports) is loaded
 * here. Variables already in the environment win — CI sets them itself.
 */
function loadDotenvFile(path: string): Record<string, string> {
	let text: string;
	try {
		text = readFileSync(path, "utf8");
	} catch {
		return {};
	}
	const out: Record<string, string> = {};
	for (const raw of text.split(/\r?\n/)) {
		const line = raw.trim();
		if (!line || line.startsWith("#")) continue;
		const eq = line.indexOf("=");
		if (eq <= 0) continue;
		const key = line.slice(0, eq).trim();
		let value = line.slice(eq + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		out[key] = value;
	}
	return out;
}

for (const [key, value] of Object.entries({
	...loadDotenvFile(resolve(repoRoot, ".env.docker")),
	...loadEnv("test", repoRoot, ""),
})) {
	process.env[key] ??= value;
}

// Skip @t3-oss/env-core validation in tests — modules like lib/env.ts
// are imported transitively, but tests don't need the full app env.
process.env.SKIP_ENV_VALIDATION = "1";

export default defineConfig({
	resolve: {
		tsconfigPaths: true,
	},
	test: {
		globals: false,
		environment: "node",
		setupFiles: ["./tests/setup.ts"],
		include: ["tests/**/*.test.ts", "server/**/*.test.ts", "lib/**/*.test.ts"],
		// Exclude frontend component tests — those use vitest.frontend.config.ts
		exclude: [
			"components/**/*.test.tsx",
			"app/**/*.test.tsx",
			"node_modules/**",
		],
		// Generous timeout for DB operations.
		testTimeout: 15_000,
		hookTimeout: 30_000,
		coverage: {
			provider: "v8",
			// lcov feeds Codecov (ci.yml); text prints the summary in the job log.
			reporter: ["text", "lcov"],
			reportsDirectory: "./coverage",
			include: ["server/**/*.ts", "lib/**/*.ts", "app/**/*.{ts,tsx}"],
			exclude: [
				"**/*.test.ts",
				"**/*.test.tsx",
				"**/*.d.ts",
				"**/*.gen.ts",
				"app/routeTree.gen.ts",
				"tests/**",
				"**/fixtures/**",
				"server/routes/**", // oRPC route wiring — tested via usecases
				"lib/sentry.ts", // external SDK wrapper
				"lib/axiom/**", // external SDK wrapper
			],
		},
	},
});
