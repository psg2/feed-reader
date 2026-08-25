import { ContextMenu, DropdownMenu } from "radix-ui";
import { cn } from "@/lib/utils";

export interface MenuAction {
	label: string;
	icon?: React.ReactNode;
	onSelect: () => void;
	destructive?: boolean;
	disabled?: boolean;
	kbd?: string;
}

const contentClass =
	"z-50 min-w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg";
const itemClass = (destructive?: boolean) =>
	cn(
		"flex cursor-default select-none items-center gap-2 rounded-md px-2 py-1.5 text-[13px] outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50",
		destructive && "text-destructive data-[highlighted]:bg-destructive/10",
	);

function Items({
	actions,
	Item,
}: {
	actions: MenuAction[];
	Item: typeof DropdownMenu.Item | typeof ContextMenu.Item;
}) {
	return actions.map((a) => (
		<Item
			key={a.label}
			disabled={a.disabled}
			onSelect={a.onSelect}
			className={itemClass(a.destructive)}
		>
			{a.icon && (
				<span className="flex h-4 w-4 shrink-0 items-center justify-center [&>svg]:h-3.5 [&>svg]:w-3.5">
					{a.icon}
				</span>
			)}
			<span className="flex-1">{a.label}</span>
			{a.kbd && (
				<kbd className="ml-4 rounded border bg-accent px-1 font-sans text-[10px] font-medium text-muted-foreground">
					{a.kbd}
				</kbd>
			)}
		</Item>
	));
}

/** Click-to-open menu. `trigger` is rendered as the button (asChild). */
export function Menu({
	trigger,
	actions,
	align = "end",
}: {
	trigger: React.ReactNode;
	actions: MenuAction[];
	align?: "start" | "end";
}) {
	return (
		<DropdownMenu.Root>
			<DropdownMenu.Trigger asChild>{trigger}</DropdownMenu.Trigger>
			<DropdownMenu.Portal>
				<DropdownMenu.Content
					align={align}
					sideOffset={4}
					className={contentClass}
				>
					<Items actions={actions} Item={DropdownMenu.Item} />
				</DropdownMenu.Content>
			</DropdownMenu.Portal>
		</DropdownMenu.Root>
	);
}

/** Right-click / long-press menu wrapping `children`. */
export function ContextActions({
	actions,
	children,
}: {
	actions: MenuAction[];
	children: React.ReactNode;
}) {
	return (
		<ContextMenu.Root>
			<ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
			<ContextMenu.Portal>
				<ContextMenu.Content className={contentClass}>
					<Items actions={actions} Item={ContextMenu.Item} />
				</ContextMenu.Content>
			</ContextMenu.Portal>
		</ContextMenu.Root>
	);
}
