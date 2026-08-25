import { useState } from "react";
import { useMountEffect } from "./use-mount-effect";

const MOBILE_BREAKPOINT = 768;

/**
 * Returns true when the viewport is narrower than the mobile breakpoint.
 * Uses `matchMedia` for efficient resize detection.
 *
 * `breakpoint` is read on mount only. If a caller needs a dynamic breakpoint,
 * remount the consumer via a `key` prop tied to the breakpoint value.
 */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT): boolean {
	const [isMobile, setIsMobile] = useState(false);

	useMountEffect(() => {
		const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
		const onChange = () => setIsMobile(mql.matches);
		onChange();
		mql.addEventListener("change", onChange);
		return () => mql.removeEventListener("change", onChange);
	});

	return isMobile;
}
