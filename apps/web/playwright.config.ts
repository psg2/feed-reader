import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, FEEDS, FIXTURE_PORT, PORT } from "./e2e/env";

/**
 * E2E configuration.
 *
 * Starts two servers: the fixture feed server (e2e/fixture-server.mjs) and
 * the app on a plain http port, bypassing portless. Locally the app runs
 * with `vite dev`; CI passes E2E_APP_COMMAND to run the production build.
 * Set E2E_REUSE=1 to reuse an app already listening on the port.
 *
 * IMPORTANT: Never use `networkidle` waits — Playwright discourages it
 * (https://playwright.dev/docs/api/class-page#page-wait-for-load-state)
 * and the dev server has long-lived connections (HMR WebSocket, devtools
 * SSE) that prevent it from ever resolving. Use element-based waits:
 * `expect(locator).toBeVisible()` or `expect(page).toHaveURL()`.
 */
const isCI = !!process.env.CI;

export default defineConfig({
	testDir: "./e2e",
	globalSetup: "./e2e/global-setup.ts",
	fullyParallel: true,
	forbidOnly: isCI,
	retries: isCI ? 2 : 0,
	// One account per worker slot (global-setup.ts); BetterAuth allows five
	// sign-ups a minute per IP, so keep this small.
	workers: isCI ? 2 : 3,
	reporter: isCI ? [["list"], ["html", { open: "never" }]] : "html",
	timeout: 45_000,
	expect: { timeout: 10_000 },

	use: {
		baseURL: BASE_URL,
		trace: "on-first-retry",
		colorScheme: "light",
	},

	webServer: [
		{
			command: "node e2e/fixture-server.mjs",
			url: FEEDS.lethain,
			env: { E2E_FIXTURE_PORT: String(FIXTURE_PORT) },
			reuseExistingServer: !isCI,
		},
		{
			command:
				process.env.E2E_APP_COMMAND ?? `pnpm exec vite dev --port ${PORT}`,
			url: `${BASE_URL}/sign-in`,
			env: {
				PORT: String(PORT),
				BETTER_AUTH_URL: BASE_URL,
				ALLOW_SIGNUP: "true",
				// The fixture feed server listens on 127.0.0.1.
				ALLOW_PRIVATE_FEED_HOSTS: "true",
			},
			reuseExistingServer: !isCI || !!process.env.E2E_REUSE,
			timeout: 180_000,
		},
	],

	projects: [
		{
			name: "desktop",
			testIgnore: /mobile\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 1440, height: 900 },
			},
		},
		{
			name: "mobile",
			testMatch: /mobile\.spec\.ts/,
			use: {
				...devices["Desktop Chrome"],
				viewport: { width: 390, height: 844 },
				isMobile: true,
				hasTouch: true,
			},
		},
	],
});
