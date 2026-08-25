import { Popover } from "radix-ui";

/**
 * Anchored confirmation for bulk actions. Controlled: the caller opens it
 * after deciding the action deserves a second look.
 */
export function ConfirmPopover({
	open,
	onOpenChange,
	question,
	onConfirm,
	confirmLabel = "Confirm",
	children,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	question: string;
	onConfirm: () => void;
	confirmLabel?: string;
	children: React.ReactNode;
}) {
	return (
		<Popover.Root open={open} onOpenChange={onOpenChange}>
			<Popover.Anchor asChild>{children}</Popover.Anchor>
			<Popover.Portal>
				<Popover.Content
					align="end"
					sideOffset={6}
					className="z-50 w-64 rounded-lg border bg-popover p-3 text-popover-foreground shadow-lg"
				>
					<p className="text-sm">{question}</p>
					<div className="mt-3 flex justify-end gap-2">
						<button
							type="button"
							onClick={() => onOpenChange(false)}
							className="rounded-md border border-input px-2.5 py-1 text-xs hover:bg-accent"
						>
							{"Cancel"}
						</button>
						<button
							type="button"
							autoFocus
							onClick={() => {
								onOpenChange(false);
								onConfirm();
							}}
							className="rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
						>
							{confirmLabel}
						</button>
					</div>
				</Popover.Content>
			</Popover.Portal>
		</Popover.Root>
	);
}
