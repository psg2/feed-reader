import * as Sentry from "@sentry/tanstackstart-react";
import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";
import { routeTree } from "./routeTree.gen";

export function getRouter() {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: {
				staleTime: 30 * 1000,
			},
		},
	});
	// Nothing observes a route gate, so the default 5 min gcTime would drop it
	// (hydrated or refreshed) right when it goes stale, and the next navigation
	// would wait on the server again instead of refreshing in the background.
	queryClient.setQueryDefaults(["gate"], { gcTime: Number.POSITIVE_INFINITY });

	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		scrollRestoration: true,
		defaultPendingMs: 200,
		defaultNotFoundComponent: () => (
			<div className="flex flex-col items-center justify-center min-h-half-screen gap-4">
				<h1 className="text-4xl font-bold">404</h1>
				<p className="text-muted-foreground">Page not found</p>
				<a href="/" className="text-primary underline">
					Go home
				</a>
			</div>
		),
	});

	// Only initialize Sentry on the client side
	if (!router.isServer) {
		const dsn = import.meta.env.VITE_PUBLIC_SENTRY_DSN;
		if (dsn) {
			Sentry.init({
				dsn,
				environment: import.meta.env.DEV ? "development" : "production",
				// Invite links carry a bearer token that can register an account.
				dataCollection: { urlQueryParams: { deny: ["invite"] } },
				integrations: [Sentry.tanstackRouterBrowserTracingIntegration(router)],
				tracesSampleRate: import.meta.env.DEV ? 0 : 0.1,
				replaysSessionSampleRate: import.meta.env.DEV ? 0 : 0.05,
				replaysOnErrorSampleRate: import.meta.env.DEV ? 0 : 1.0,
			});
		}
	}

	setupRouterSsrQueryIntegration({ router, queryClient });

	return router;
}

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}
