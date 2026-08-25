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

	const router = createRouter({
		routeTree,
		context: { queryClient },
		defaultPreload: "intent",
		scrollRestoration: true,
		defaultPendingMs: 200,
		defaultNotFoundComponent: () => (
			<div className="flex flex-col items-center justify-center min-h-[50vh] gap-4">
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
				sendDefaultPii: true,
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
