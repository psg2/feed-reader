import { useEffect } from "react";

/**
 * Run an effect exactly once on mount. Returned cleanup runs on unmount.
 *
 * Escape hatch from the no-useEffect rule for genuine external-system
 * subscriptions: DOM listeners, third-party widget lifecycles, browser-API
 * sync. See .agents/skills/no-use-effect/SKILL.md (Rule 4).
 */
export function useMountEffect(effect: () => void | (() => void)): void {
	// oxlint-disable-next-line no-use-effect/no-use-effect, react-hooks/exhaustive-deps
	useEffect(effect, []);
}
