import type { KnipConfig } from "knip";

const config: KnipConfig = {
	entry: [
		"app/**/*.{ts,tsx}",
		// Infrastructure entry points imported by framework/config, not app code
		"lib/env.ts",
		"lib/utils.ts",
		"lib/orpc.ts",
		"lib/sentry.ts",
		"lib/auth.ts",
		"lib/auth-client.ts",
		"lib/email.ts",
		"server/auth.ts",
		"server/routes/base.ts",
		"hooks/use-mobile.ts",
		"components/shared/route-fallbacks.tsx",
		// Test infrastructure
		"tests/factories.ts",
		"tests/test-fixtures.ts",
		// E2E tests
		"e2e/**/*.ts",
	],
	project: ["**/*.{ts,tsx}"],
	ignoreDependencies: [
		"@feedreader/tailwind-config",
		// shadcn/ui component variants
		"class-variance-authority",
		// app/globals.css imports shadcn/tailwind.css — knip does not follow CSS
		"shadcn",
		// Tailwind toolchain — knip can't trace CSS imports
		"tailwindcss",
		"@tailwindcss/typography",
		"tw-animate-css",
		// Testing — used in component tests via import
		"@testing-library/user-event",
	],
	ignoreExportsUsedInFile: true,
};

export default config;
