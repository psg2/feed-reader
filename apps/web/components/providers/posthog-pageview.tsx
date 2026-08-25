import { useRouter } from "@tanstack/react-router";
import posthog from "posthog-js";
import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Captures $pageview on every TanStack Router navigation.
 *
 * Uses posthog directly (not usePostHog()) to avoid calling posthog-js/react
 * hooks during SSR — posthog-js/react can have its own React instance which
 * causes a null dispatcher crash when useContext is called server-side.
 */
export function PostHogPageViewClient(): null {
	const router = useRouter();

	useMountEffect(() =>
		router.subscribe("onResolved", () => {
			posthog.capture("$pageview", {
				$current_url: window.location.href,
			});
		}),
	);

	return null;
}
