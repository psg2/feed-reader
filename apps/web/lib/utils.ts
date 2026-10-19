import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Tokens declared in app/globals.css. Without them tailwind-merge reads
// `text-ui` as a text color and drops it next to `text-muted-foreground`.
const twMerge = extendTailwindMerge({
	extend: {
		theme: {
			text: ["3xs", "2xs", "ui", "title", "reading", "headline"],
			leading: ["reading"],
			tracking: ["code"],
			container: ["measure"],
			animate: ["fade-in", "drawer-in"],
		},
	},
});

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
