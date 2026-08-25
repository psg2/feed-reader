import { PostHogProvider as PHProvider } from "posthog-js/react";
import type { ReactNode } from "react";

const apiKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;

// Default to a same-origin proxy (/ingest) so ad blockers don't drop events;
// set VITE_PUBLIC_POSTHOG_HOST to a full URL to bypass it.
const apiHost = import.meta.env.VITE_PUBLIC_POSTHOG_HOST ?? "/ingest";

const posthogOptions = {
	api_host: apiHost,
	// api_host is a relative path, so the SDK can't infer where the app lives.
	ui_host: "https://us.posthog.com",
	person_profiles: "identified_only",
	capture_pageview: false,
	capture_pageleave: true,
} as const;

// PHProvider calls useRef/useContext against its own bundled React instance
// during SSR — guard with typeof window so it only mounts on the client.
export function PostHogProvider({
	children,
}: {
	children: ReactNode;
}): React.ReactElement {
	if (typeof window === "undefined" || !apiKey) {
		return <>{children}</>;
	}

	return (
		<PHProvider apiKey={apiKey} options={posthogOptions}>
			{children}
		</PHProvider>
	);
}
