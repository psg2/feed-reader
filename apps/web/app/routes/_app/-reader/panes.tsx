import { Link } from "@tanstack/react-router";
import { Inbox, Layers, PanelLeft, Plus, Rss, Star } from "lucide-react";
import { useRef } from "react";
import { isNewsletter } from "@/components/shared/feed-icon";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/tooltip";
import { PANES, type PaneStore, usePaneSizes } from "@/hooks/use-pane-sizes";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { IconButton, type Search, SidebarFooter } from "../reader";
import { KEYS } from "./shortcuts";

// ── Drag handle ────────────────────────────────────────────────────────────

/**
 * Zero-width separator sitting on the 1px border between two panes, with a
 * 6px hit area. Pointer capture keeps the drag alive when the cursor leaves
 * the strip; arrow keys nudge by 16px, Home/End jump to the bounds, and a
 * double-click restores the default width.
 */
function PaneHandle({
	label,
	value,
	min,
	max,
	onDrag,
	onKey,
	onReset,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	onDrag: (px: number, startValue: number) => void;
	onKey: (key: string) => boolean;
	onReset: () => void;
}) {
	const drag = useRef<{ id: number; startX: number; startValue: number }>(null);

	const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
		if (drag.current?.id !== e.pointerId) return;
		drag.current = null;
		if (e.currentTarget.hasPointerCapture(e.pointerId))
			e.currentTarget.releasePointerCapture(e.pointerId);
		document.body.style.removeProperty("cursor");
		document.body.style.removeProperty("user-select");
	};

	return (
		<div className="relative z-10 hidden w-0 shrink-0 md:block">
			<div
				role="separator"
				aria-orientation="vertical"
				aria-label={label}
				aria-valuemin={min}
				aria-valuemax={max}
				aria-valuenow={value}
				tabIndex={0}
				className="absolute inset-y-0 -left-0.75 w-1.5 cursor-col-resize touch-none outline-none before:absolute before:inset-y-0 before:left-0.5 before:w-px before:bg-primary/0 hover:before:bg-primary/40 focus-visible:before:bg-primary data-[dragging]:before:bg-primary motion-safe:before:transition-colors motion-safe:before:delay-75"
				onPointerDown={(e) => {
					if (e.button !== 0) return;
					e.preventDefault();
					drag.current = {
						id: e.pointerId,
						startX: e.clientX,
						startValue: value,
					};
					e.currentTarget.setPointerCapture(e.pointerId);
					e.currentTarget.setAttribute("data-dragging", "");
					document.body.style.cursor = "col-resize";
					document.body.style.userSelect = "none";
				}}
				onPointerMove={(e) => {
					const d = drag.current;
					if (!d || d.id !== e.pointerId) return;
					onDrag(d.startValue + (e.clientX - d.startX), d.startValue);
				}}
				onPointerUp={(e) => {
					endDrag(e);
					e.currentTarget.removeAttribute("data-dragging");
				}}
				onPointerCancel={(e) => {
					endDrag(e);
					e.currentTarget.removeAttribute("data-dragging");
				}}
				onDoubleClick={onReset}
				onKeyDown={(e) => {
					if (onKey(e.key)) e.preventDefault();
				}}
			/>
		</div>
	);
}

// ── Sidebar pane ───────────────────────────────────────────────────────────

/**
 * Desktop sidebar column: the full sidebar (children) at its stored width, or
 * the 56px icon rail when collapsed, followed by the resize handle. Hidden
 * below `md`, where the drawer in reader.tsx takes over.
 */
export function SidebarPane({
	activeView,
	onAddFeed,
	onHelp,
	children,
}: {
	activeView: string;
	onAddFeed: () => void;
	onHelp: () => void;
	children: React.ReactNode;
}) {
	const { sidebar, collapsed, store } = usePaneSizes();
	const width = collapsed ? PANES.sidebar.rail : sidebar;
	return (
		<>
			<div
				className="hidden shrink-0 md:flex md:w-(--pane-sidebar)"
				// A CSS variable so the class can scope the width to `md:` and the
				// mobile layout keeps its own.
				style={{ "--pane-sidebar": `${width}px` } as React.CSSProperties}
			>
				{collapsed ? (
					<CompactSidebar
						key="rail"
						activeView={activeView}
						onAddFeed={onAddFeed}
						onHelp={onHelp}
					/>
				) : (
					<div
						key="full"
						className="flex min-w-0 flex-1 motion-safe:animate-fade-in"
					>
						{children}
					</div>
				)}
			</div>
			<PaneHandle
				label="Resize sidebar"
				value={width}
				min={PANES.sidebar.min}
				max={PANES.sidebar.max}
				onDrag={(px, start) =>
					store.dragSidebar(px, collapsed ? undefined : start)
				}
				onReset={store.resetSidebar}
				onKey={(key) => sidebarKey(key, store, collapsed, sidebar)}
			/>
		</>
	);
}

function sidebarKey(
	key: string,
	store: PaneStore,
	collapsed: boolean,
	sidebar: number,
): boolean {
	switch (key) {
		case "ArrowLeft":
			if (collapsed) return true;
			if (sidebar <= PANES.sidebar.min) store.setCollapsed(true);
			else store.setSidebar(sidebar - PANES.step);
			return true;
		case "ArrowRight":
			if (collapsed) store.setCollapsed(false);
			else store.setSidebar(sidebar + PANES.step);
			return true;
		case "Home":
			store.setCollapsed(true);
			return true;
		case "End":
			store.setCollapsed(false);
			store.setSidebar(PANES.sidebar.max);
			return true;
		case "Enter":
			store.resetSidebar();
			return true;
		default:
			return false;
	}
}

const railLink = (active: boolean) =>
	cn(
		"relative flex h-9 w-9 items-center justify-center rounded-md text-sidebar-foreground/90 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
		active && "bg-sidebar-accent text-sidebar-foreground",
	);

/** Icon rail shown when the sidebar is collapsed. Tags are omitted; feeds
 * become letter avatars with the name and unread count in a tooltip. */
function CompactSidebar({
	activeView,
	onAddFeed,
	onHelp,
}: {
	activeView: string;
	onAddFeed: () => void;
	onHelp: () => void;
}) {
	const { data: feeds = [] } = api.reader.useFeeds();
	const totalUnread = feeds.reduce((n, f) => n + f.unread, 0);
	const view = (
		name: string,
		label: string,
		icon: React.ReactNode,
		kbd: string,
		badge?: number,
	) => (
		<Tip key={name} label={label} kbd={kbd} side="right">
			<Link
				to="/reader"
				search={(prev: Search) => ({ ...prev, view: name, item: undefined })}
				aria-label={badge ? `${label}, ${badge} unread` : label}
				className={railLink(activeView === name)}
			>
				{icon}
				{badge !== undefined && badge > 0 && (
					<span className="absolute right-0 top-0 min-w-4 rounded-full bg-primary px-1 text-center text-3xs font-semibold leading-4 text-primary-foreground tabular-nums">
						{badge > 999 ? "999+" : badge}
					</span>
				)}
			</Link>
		</Tip>
	);

	return (
		<nav
			aria-label="Sidebar"
			className="flex w-full flex-col items-center border-r border-sidebar-border bg-sidebar motion-safe:animate-fade-in"
		>
			<div className="flex h-12 items-center pt-safe">
				<Rss className="h-4 w-4 text-primary" strokeWidth={2.5} />
			</div>
			<div className="flex min-h-0 flex-1 flex-col items-center gap-0.5 overflow-y-auto px-1.5 pt-1 pb-2 scrollbar-none">
				{view(
					"unread",
					"Unread",
					<Inbox className="h-4 w-4 text-muted-foreground" />,
					KEYS.unread,
					totalUnread,
				)}
				{view(
					"all",
					"All",
					<Layers className="h-4 w-4 text-muted-foreground" />,
					KEYS.all,
				)}
				{view(
					"starred",
					"Starred",
					<Star className="h-4 w-4 text-muted-foreground" />,
					KEYS.starred,
				)}
				<div className="my-2 h-px w-6 shrink-0 bg-sidebar-border" />
				{feeds.map((f) => {
					const id = `feed:${f.id}`;
					const label = f.unread > 0 ? `${f.title} · ${f.unread}` : f.title;
					return (
						<Tip key={f.id} label={label} side="right">
							<Link
								to="/reader"
								search={(prev: Search) => ({
									...prev,
									view: id,
									item: undefined,
								})}
								aria-label={label}
								className={cn(railLink(activeView === id), "h-8 w-8")}
							>
								<span
									aria-hidden
									className={cn(
										"flex h-6 w-6 items-center justify-center rounded-md border border-sidebar-border bg-card text-2xs font-semibold uppercase leading-none",
										isNewsletter(f.url) && "rounded-full",
										!f.enabled && "opacity-50",
										f.unread === 0 && "text-muted-foreground",
									)}
								>
									{initial(f.title)}
								</span>
							</Link>
						</Tip>
					);
				})}
				<Tip label="Add feed" kbd={KEYS.addFeed} side="right">
					<Button
						type="button"
						aria-label="Add feed"
						onClick={onAddFeed}
						variant="sidebar"
						size="icon"
						className="mt-1 shrink-0"
					>
						<Plus className="h-4 w-4" />
					</Button>
				</Tip>
			</div>
			<SidebarFooter onHelp={onHelp} stacked />
		</nav>
	);
}

function initial(title: string): string {
	const word = title.trim().replace(/^(the|a|an)\s+/i, "");
	const ch = [...word][0];
	return ch && /\p{L}|\p{N}/u.test(ch) ? ch : "#";
}

// ── List pane ──────────────────────────────────────────────────────────────

/** Handle between the list and the detail pane. */
export function ListHandle() {
	const { list, store } = usePaneSizes();
	return (
		<PaneHandle
			label="Resize list"
			value={list}
			min={PANES.list.min}
			max={PANES.list.max}
			onDrag={store.setList}
			onReset={store.resetList}
			onKey={(key) => {
				switch (key) {
					case "ArrowLeft":
						store.setList(list - PANES.step);
						return true;
					case "ArrowRight":
						store.setList(list + PANES.step);
						return true;
					case "Home":
						store.setList(PANES.list.min);
						return true;
					case "End":
						store.setList(PANES.list.max);
						return true;
					case "Enter":
						store.resetList();
						return true;
					default:
						return false;
				}
			}}
		/>
	);
}

/** Stored width of the list column in px; feed it to `--pane-list`. */
export function useListWidth() {
	return usePaneSizes().list;
}

/** Collapse/expand button for the list header (desktop only). */
export function SidebarToggle() {
	const { collapsed, store } = usePaneSizes();
	return (
		<div className="hidden md:block">
			<IconButton
				label={collapsed ? "Show sidebar" : "Hide sidebar"}
				kbd={KEYS.sidebar}
				onClick={store.toggleCollapsed}
			>
				<PanelLeft className="h-4 w-4" />
			</IconButton>
		</div>
	);
}
