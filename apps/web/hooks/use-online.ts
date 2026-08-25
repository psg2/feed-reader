import { useState } from "react";
import { useMountEffect } from "./use-mount-effect";

/** Tracks `navigator.onLine`; true during SSR and until the first event. */
export function useOnline(): boolean {
	const [online, setOnline] = useState(true);
	useMountEffect(() => {
		const sync = () => setOnline(navigator.onLine);
		sync();
		window.addEventListener("online", sync);
		window.addEventListener("offline", sync);
		return () => {
			window.removeEventListener("online", sync);
			window.removeEventListener("offline", sync);
		};
	});
	return online;
}
