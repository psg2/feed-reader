import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getAuthUserIdFn } from "@/app/server-fns/auth";

export const Route = createFileRoute("/_app")({
	beforeLoad: async ({ location }) => {
		const userId = await getAuthUserIdFn();
		if (!userId) {
			// `location.href` keeps path+query+hash so the user lands back where
			// they were headed after signing in.
			throw redirect({ to: "/sign-in", search: { redirect: location.href } });
		}
		return { userId };
	},
	component: AppLayout,
});

function AppLayout() {
	return (
		<div className="min-h-screen bg-muted/50">
			<a
				href="#main-content"
				className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-[100] focus:px-4 focus:py-2 focus:bg-white focus:text-foreground focus:rounded-md focus:shadow-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
			>
				Skip to main content
			</a>
			<main id="main-content" tabIndex={-1} className="outline-none">
				<Outlet />
			</main>
		</div>
	);
}
