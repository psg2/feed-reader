import { Tooltip } from "radix-ui";

/** Mount once near the app root so hover delay is shared across triggers. */
export function TipProvider({ children }: { children: React.ReactNode }) {
	return (
		<Tooltip.Provider delayDuration={350} skipDelayDuration={250}>
			{children}
		</Tooltip.Provider>
	);
}

/**
 * App tooltip: label plus an optional keyboard-shortcut chip, replacing the
 * browser-native `title` bubble. Hover/focus only — inert on touch, where the
 * control's own affordance has to carry the meaning.
 */
export function Tip({
	label,
	kbd,
	side = "bottom",
	children,
}: {
	label: string;
	kbd?: string;
	side?: "top" | "bottom" | "left" | "right";
	children: React.ReactNode;
}) {
	return (
		<Tooltip.Root>
			<Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
			<Tooltip.Portal>
				<Tooltip.Content
					side={side}
					sideOffset={6}
					className="z-50 flex select-none items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
				>
					{label}
					{kbd && (
						<kbd className="rounded border bg-accent px-1 font-sans text-[10px] font-medium text-muted-foreground">
							{kbd}
						</kbd>
					)}
				</Tooltip.Content>
			</Tooltip.Portal>
		</Tooltip.Root>
	);
}
