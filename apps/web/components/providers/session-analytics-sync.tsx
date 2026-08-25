import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useSessionContext } from "@/components/providers/session-provider";
import { clearSentryUser, setSentryUser } from "@/lib/sentry";

/**
 * Mirrors the auth session into PostHog (identity) and Sentry (error
 * attribution). Reads the shared session from context — no extra subscription.
 *
 * This is the one sanctioned `useEffect` in app code: syncing auth state into
 * an external analytics system is the documented exception both vendors point
 * to `useEffect` for.
 *   - PostHog: https://posthog.com/docs/product-analytics/identify
 *   - Sentry:  https://docs.sentry.io/platforms/javascript/guides/react/enriching-events/identify-user/
 *
 * A ref tracks the last-synced user id so we only act when identity actually
 * changes (sign-in / sign-out / account switch), not on every session refetch
 * — PostHog's "don't re-identify the same user" guidance, without reaching for
 * the private `_isIdentified()`.
 */
export function SessionAnalyticsSync(): null {
	const { session, isPending } = useSessionContext();
	// `undefined` = never synced yet, so the first resolved state always runs
	// (identify when signed in, reset when anonymous); `string | null` dedupes after.
	const lastUserId = useRef<string | null | undefined>(undefined);

	// oxlint-disable-next-line no-use-effect/no-use-effect -- sanctioned analytics sync (see above)
	useEffect(() => {
		if (isPending) return;
		const user = session?.user ?? null;
		const nextId = user?.id ?? null;
		if (nextId === lastUserId.current) return;
		lastUserId.current = nextId;

		if (user) {
			posthog.identify(user.id, { email: user.email, name: user.name });
			setSentryUser({ id: user.id, email: user.email });
		} else {
			posthog.reset();
			clearSentryUser();
		}
	}, [session, isPending]);

	return null;
}
