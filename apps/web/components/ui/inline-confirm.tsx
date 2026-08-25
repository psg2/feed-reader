import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Two-step confirm rendered in place of a destructive control: the first
 * click swaps the trigger for "<question> Yes / No". Replaces window.confirm
 * without a modal.
 */
export function InlineConfirm({
	question,
	onConfirm,
	disabled,
	confirmLabel = "Yes",
	className,
	children,
}: {
	question: string;
	onConfirm: () => void;
	disabled?: boolean;
	confirmLabel?: string;
	className?: string;
	/** The idle trigger; receives the click that arms the confirm. */
	children: (arm: () => void) => React.ReactNode;
}) {
	const [armed, setArmed] = useState(false);
	if (!armed) return <>{children(() => setArmed(true))}</>;
	return (
		<span
			className={cn(
				"flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground",
				className,
			)}
		>
			<span>{question}</span>
			<button
				type="button"
				autoFocus
				disabled={disabled}
				onClick={() => {
					setArmed(false);
					onConfirm();
				}}
				className="rounded-md bg-destructive px-2 py-1 font-medium text-white hover:bg-destructive/90 disabled:opacity-50"
			>
				{confirmLabel}
			</button>
			<button
				type="button"
				onClick={() => setArmed(false)}
				className="rounded-md border border-input px-2 py-1 hover:bg-accent"
			>
				{"No"}
			</button>
		</span>
	);
}
