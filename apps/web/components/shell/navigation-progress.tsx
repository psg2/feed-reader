import { useRouterState } from "@tanstack/react-router";

/**
 * A thin bar along the top while a navigation waits on its route gates or
 * loaders. Its CSS delay keeps it hidden on navigations that finish fast.
 */
export function NavigationProgress() {
	const pending = useRouterState({ select: (s) => s.status === "pending" });
	if (!pending) return null;
	return (
		<div
			role="progressbar"
			aria-label="Loading page"
			className="pointer-events-none fixed inset-x-0 top-safe z-50 h-0.5 animate-nav-progress bg-primary"
		/>
	);
}
