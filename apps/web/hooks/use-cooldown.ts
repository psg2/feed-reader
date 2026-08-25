import { useCallback, useRef, useState } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

/**
 * Countdown timer for "resend OTP" cooldowns. Returns `secondsLeft` (0 when
 * idle) and a `start()` to (re)arm the timer. Cleans up on unmount.
 *
 * The interval is an external timer (not derivable from React state), so
 * `useMountEffect` is the right escape hatch for the unmount cleanup —
 * `clear()` reads from a ref, so the dep-array nuance doesn't apply.
 */
export function useCooldown(durationSeconds: number): {
	secondsLeft: number;
	start: () => void;
} {
	const [secondsLeft, setSecondsLeft] = useState(0);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const clear = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
	}, []);

	const start = useCallback(() => {
		clear();
		setSecondsLeft(durationSeconds);
		intervalRef.current = setInterval(() => {
			setSecondsLeft((prev) => {
				if (prev <= 1) {
					clear();
					return 0;
				}
				return prev - 1;
			});
		}, 1000);
	}, [durationSeconds, clear]);

	useMountEffect(() => clear);

	return { secondsLeft, start };
}
