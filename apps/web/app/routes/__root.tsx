/// <reference types="vite/client" />
import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import { ReactQueryDevtoolsPanel } from "@tanstack/react-query-devtools";
import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { Toaster } from "sonner";
import { PostHogPageViewClient } from "@/components/providers/posthog-pageview";
import { PostHogProvider } from "@/components/providers/posthog-provider";
import { SessionAnalyticsSync } from "@/components/providers/session-analytics-sync";
import { SessionProvider } from "@/components/providers/session-provider";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { TipProvider } from "@/components/ui/tooltip";
import {
	DefaultErrorComponent,
	DefaultNotFoundComponent,
} from "@/components/shared/route-fallbacks";
import globalsCss from "../globals.css?url";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()(
	{
		errorComponent: DefaultErrorComponent,
		notFoundComponent: DefaultNotFoundComponent,
		head: () => ({
			meta: [
				{ charSet: "utf-8" },
				{
					name: "viewport",
					content: "width=device-width, initial-scale=1, viewport-fit=cover",
				},
				{ title: "Feed Reader" },
				{
					name: "description",
					content: "Your blogs and newsletters, one quiet inbox.",
				},
				{
					name: "theme-color",
					media: "(prefers-color-scheme: light)",
					content: "#f8f6f1",
				},
				{
					name: "theme-color",
					media: "(prefers-color-scheme: dark)",
					content: "#1d1b18",
				},
				// Disables browser auto-translation. Without it, Chrome/Samsung on
				// mobile translate the page, wrap text nodes in <font> and break
				// React reconciliation ("insertBefore ... is not a child of this
				// node"). Pairs with translate="no" on <html>.
				{ name: "google", content: "notranslate" },
				// PWA: installable to the home screen (iOS reads these metas, not the manifest)
				{ name: "mobile-web-app-capable", content: "yes" },
				{ name: "apple-mobile-web-app-capable", content: "yes" },
				{ name: "apple-mobile-web-app-title", content: "Feed Reader" },
				{
					name: "apple-mobile-web-app-status-bar-style",
					content: "black-translucent",
				},
				// Open Graph
				{ property: "og:type", content: "website" },
				{ property: "og:site_name", content: "Feed Reader" },
				{ property: "og:title", content: "Feed Reader" },
				{
					property: "og:description",
					content: "Your blogs and newsletters, one quiet inbox.",
				},
				{ property: "og:image", content: "/og-image.jpg" },
				{ property: "og:image:width", content: "1200" },
				{ property: "og:image:height", content: "630" },
				// Twitter Card
				{ name: "twitter:card", content: "summary_large_image" },
				{ name: "twitter:title", content: "Feed Reader" },
				{
					name: "twitter:description",
					content: "Your blogs and newsletters, one quiet inbox.",
				},
				{ name: "twitter:image", content: "/og-image.jpg" },
			],
			links: [
				{ rel: "stylesheet", href: globalsCss },
				{ rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
				{ rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
				{ rel: "manifest", href: "/manifest.json" },
			],
		}),
		component: RootComponent,
	},
);

function RootComponent() {
	return (
		<RootDocument>
			<Outlet />
		</RootDocument>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	return (
		// translate="no" prevents the browser-translation crash described above.
		<html lang="en" translate="no" suppressHydrationWarning>
			<head>
				<HeadContent />
			</head>
			<body>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					disableTransitionOnChange
				>
					<PostHogProvider>
						<SessionProvider>
							<TipProvider>
								<SessionAnalyticsSync />
								<PostHogPageViewClient />
								{children}
								<Toaster />
							</TipProvider>
						</SessionProvider>
					</PostHogProvider>
				</ThemeProvider>
				{import.meta.env.DEV && (
					<TanStackDevtools
						plugins={[
							{
								name: "TanStack Query",
								render: <ReactQueryDevtoolsPanel />,
								defaultOpen: true,
							},
							{
								name: "TanStack Router",
								render: <TanStackRouterDevtoolsPanel />,
								defaultOpen: false,
							},
						]}
					/>
				)}
				<Scripts />
			</body>
		</html>
	);
}
