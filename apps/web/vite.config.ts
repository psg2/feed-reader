import { sentryTanstackStart } from "@sentry/tanstackstart-react/vite";
import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import type { PluginOption } from "vite";
import { defineConfig } from "vite";

export default defineConfig({
	// Load .env files from repo root (where .env and .env.local live)
	envDir: "../..",
	server: {
		port: Number(process.env.PORT ?? 3000),
		allowedHosts: true, // Allow ngrok, Vercel previews, etc.
		// Mirror the prod /ingest proxy (vercel.json) so the same path works in dev.
		// /ingest/static and /ingest/array must precede the catch-all — they go to
		// the assets host, not the ingest host.
		proxy: {
			"/ingest/static": {
				target: "https://us-assets.i.posthog.com",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/ingest/, ""),
			},
			"/ingest/array": {
				target: "https://us-assets.i.posthog.com",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/ingest/, ""),
			},
			"/ingest": {
				target: "https://us.i.posthog.com",
				changeOrigin: true,
				rewrite: (path) => path.replace(/^\/ingest/, ""),
			},
		},
	},
	plugins: [
		// TanStack Devtools Vite plugin — must be first
		devtools(),
		tailwindcss(),
		tanstackStart({
			srcDirectory: "./app",
			router: {
				routesDirectory: "./routes",
				generatedRouteTree: "./routeTree.gen.ts",
				quoteStyle: "double",
				semicolons: true,
				routeFileIgnorePrefix: "-",
				codeSplittingOptions: {
					defaultBehavior: [
						["component"],
						["errorComponent"],
						["notFoundComponent"],
						["loader"],
					],
				},
			},
		}),
		// Nitro handles server deployment targets (Vercel, Node.js, etc.).
		// NITRO_PRESET=node-server yields .output/server/index.mjs for
		// `pnpm start` (CI runs the e2e suite against it).
		// Nitro bundles the whole app into one Vercel function, so the cron
		// refresh (many feeds, 6 at a time) sets the budget for everything.
		nitro({
			preset: process.env.NITRO_PRESET ?? "vercel",
			vercel: { functions: { maxDuration: 300 } },
		}) as PluginOption,
		// React plugin must come AFTER tanstackStart
		viteReact(),

		// sentryTanstackStart must be last — handles source map uploads.
		// Only active when SENTRY_AUTH_TOKEN is present (CI/production).
		...(process.env.SENTRY_AUTH_TOKEN
			? [
					sentryTanstackStart({
						org: process.env.SENTRY_ORG,
						project: process.env.SENTRY_PROJECT,
						authToken: process.env.SENTRY_AUTH_TOKEN,
					}),
				]
			: []),
	],
	resolve: {
		tsconfigPaths: true,
		// Force all packages to use the same React instance.
		dedupe: ["react", "react-dom"],
	},
});
