import type { ReaderFeed, ReaderFilter, ReaderItem } from "@feedreader/api";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
	CheckCheck,
	ChevronLeft,
	CircleHelp,
	Copy,
	ExternalLink,
	FileUp,
	Inbox,
	Layers,
	LogOut,
	Mail,
	Menu as MenuIcon,
	Moon,
	MoreHorizontal,
	Pause,
	Play,
	Plus,
	RefreshCw,
	Rss,
	Search as SearchIcon,
	Settings as SettingsIcon,
	Star,
	Sun,
	Tag,
	Trash2,
	WifiOff,
	X,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Palette } from "./-reader/palette";
import { ItemDetail } from "./-reader/item-detail";
import {
	ListHandle,
	SidebarPane,
	SidebarToggle,
	useListWidth,
} from "./-reader/panes";
import { KEYS, ShortcutsHelp, useReaderShortcuts } from "./-reader/shortcuts";
import { undo } from "./-reader/undo";
import { FeedIcon, isNewsletter } from "@/components/shared/feed-icon";
import { ConfirmPopover } from "@/components/ui/confirm-popover";
import { ContextActions, Menu, type MenuAction } from "@/components/ui/menu";
import { Tip } from "@/components/ui/tooltip";
import { useOnline } from "@/hooks/use-online";
import { paneStore } from "@/hooks/use-pane-sizes";
import { signOut } from "@/lib/auth-client";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

export type Search = {
	view?: string; // "unread" | "all" | "starred" | "feed:<id>" | "tag:<name>"
	q?: string;
	item?: string;
};

export const Route = createFileRoute("/_app/reader")({
	validateSearch: (s: Record<string, unknown>): Search => ({
		view: typeof s.view === "string" ? s.view : undefined,
		q: typeof s.q === "string" && s.q !== "" ? s.q : undefined,
		item: typeof s.item === "string" ? s.item : undefined,
	}),
	component: ReaderPage,
});

function parseView(view: string | undefined): ReaderFilter {
	if (!view || view === "unread") return { kind: "unread" };
	if (view === "all") return { kind: "all" };
	if (view === "starred") return { kind: "starred" };
	if (view.startsWith("feed:")) return { kind: "feed", feedId: view.slice(5) };
	if (view.startsWith("tag:")) return { kind: "tag", tag: view.slice(4) };
	return { kind: "unread" };
}

export type ListInput = { filter: ReaderFilter; search: string; limit: number };

export function useListInput(): ListInput {
	const { view, q } = Route.useSearch();
	return useMemo(
		() => ({ filter: parseView(view), search: q ?? "", limit: 200 }),
		[view, q],
	);
}

export function useViewLabel(): string {
	const { view } = Route.useSearch();
	const { data: feeds = [] } = api.reader.useFeeds();
	if (!view || view === "unread") return "Unread";
	if (view === "all") return "All";
	if (view === "starred") return "Starred";
	if (view.startsWith("feed:"))
		return feeds.find((f) => f.id === view.slice(5))?.title ?? "Feed";
	if (view.startsWith("tag:")) return `#${view.slice(4)}`;
	return "Unread";
}

/** Mark-all-as-read scoped to a view, with a 6s Undo toast and the `z` undo slot. */
export function useMarkAllWithUndo() {
	const markRead = api.reader.useMarkRead();
	const markAll = api.reader.useMarkAllRead();
	return {
		pending: markAll.isPending,
		run: (filter: ReaderFilter, label: string) =>
			markAll.mutate(
				{ filter },
				{
					onSuccess: (data) => {
						const { changed } = data as { changed: string[] };
						if (changed.length === 0) return toast.info("Nothing to mark");
						// markRead accepts 5000 ids per call.
						const revert = () => {
							for (let i = 0; i < changed.length; i += 5000)
								markRead.mutate({
									itemIds: changed.slice(i, i + 5000),
									read: false,
								});
						};
						undo.set("mark all as read", revert);
						toast.success(
							`Marked ${changed.length.toLocaleString()} as read in ${label}`,
							{ action: { label: "Undo", onClick: revert }, duration: 6000 },
						);
					},
					onError: (e) => toast.error(e.message),
				},
			),
	};
}

/** Refresh-all with result toast, shared by the list header, the palette and
 * the `r` shortcut. */
export function useRefreshWithToast() {
	return api.reader.useRefresh({
		onSuccess: (s) => {
			const sum = s as { newItems: number; feedsFailed: number };
			toast.success(
				sum.newItems > 0 ? `${sum.newItems} new posts` : "No new posts",
				sum.feedsFailed > 0
					? { description: `${sum.feedsFailed} feeds failed` }
					: undefined,
			);
		},
		onError: (e) => toast.error(e.message),
	});
}

/** Single-item read/star toggles: silent, optimistic, and undoable with `z`. */
export function useItemActions(listInput: ListInput) {
	const update = api.reader.useUpdateItem(listInput, {
		onError: (e) => toast.error(e.message),
	});
	const setRead = (item: ReaderItem, read: boolean) => {
		update.mutate({ itemId: item.id, read });
		undo.set(read ? "mark as read" : "mark as unread", () =>
			update.mutate({ itemId: item.id, read: !read }),
		);
	};
	return {
		update,
		setRead,
		toggleRead: (item: ReaderItem) => setRead(item, item.readAt === null),
		toggleStar: (item: ReaderItem) => {
			update.mutate({ itemId: item.id, starred: !item.starred });
			undo.set(item.starred ? "unstar" : "star", () =>
				update.mutate({ itemId: item.id, starred: item.starred }),
			);
		},
	};
}

/** Unread posts in the current view; used to label the mark-all control. */
function useUnreadInView(listInput: ListInput, items: ReaderItem[]) {
	const { data: feeds = [] } = api.reader.useFeeds();
	const { filter } = listInput;
	if (filter.kind === "unread" && !listInput.search)
		return feeds.reduce((n, f) => n + f.unread, 0);
	if (filter.kind === "feed" && !listInput.search)
		return feeds.find((f) => f.id === filter.feedId)?.unread ?? 0;
	return items.filter((i) => i.readAt === null).length;
}

// ── Page shell ─────────────────────────────────────────────────────────────

function ReaderPage() {
	const search = Route.useSearch();
	const navigate = useNavigate({ from: Route.fullPath });
	const listInput = useListInput();
	const viewLabel = useViewLabel();
	const selectedId = search.item;
	const itemsQuery = api.reader.useItems(listInput);
	const items = itemsQuery.data ?? [];
	const actions = useItemActions(listInput);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [helpOpen, setHelpOpen] = useState(false);
	const [showAdd, setShowAdd] = useState(false);
	const [navOpen, setNavOpen] = useState(false);
	const [confirmMarkAll, setConfirmMarkAll] = useState(false);
	const refresh = useRefreshWithToast();
	const markAll = useMarkAllWithUndo();
	const unreadInView = useUnreadInView(listInput, items);
	const listWidth = useListWidth();
	const pruneRead = api.reader.usePruneReadFromUnread();

	// Moving the selection is when rows marked read in place leave Unread.
	const openItem = (id: string | undefined, dropId?: string) => {
		pruneRead(listInput, id, dropId);
		navigate({ search: (prev: Search) => ({ ...prev, item: id }) });
	};
	const setView = (view: string) =>
		navigate({
			search: (prev: Search) => ({ ...prev, view, item: undefined }),
		});

	const selected = items.find((i) => i.id === selectedId);
	const at = items.findIndex((i) => i.id === selectedId);
	const hasPrev = at > 0;
	const hasNext = at === -1 ? items.length > 0 : at < items.length - 1;
	const move = (offset: 1 | -1, dropId?: string) => {
		if (items.length === 0) return;
		const next = at === -1 ? 0 : at + offset;
		if (next < 0 || next >= items.length) return;
		openItem(items[next].id, dropId);
	};
	const readAndNext = () => {
		if (!selected) return;
		actions.setRead(selected, true);
		move(1, selected.id);
	};

	// All and tag views can sweep a lot at once; ask first. Unread, starred
	// and a single feed are what the user is looking at, so just do it.
	const needsConfirm =
		listInput.filter.kind === "all" || listInput.filter.kind === "tag";
	const doMarkAll = () => markAll.run(listInput.filter, viewLabel);
	const requestMarkAll = () => {
		if (unreadInView === 0) return toast.info("Nothing to mark");
		if (needsConfirm) setConfirmMarkAll(true);
		else doMarkAll();
	};

	useReaderShortcuts({
		overlayOpen: paletteOpen || helpOpen || navOpen || confirmMarkAll,
		closeOverlays: () => {
			setPaletteOpen(false);
			setHelpOpen(false);
			setNavOpen(false);
			setConfirmMarkAll(false);
		},
		next: () => move(1),
		prev: () => move(-1),
		toggleRead: () => selected && actions.toggleRead(selected),
		toggleStar: () => selected && actions.toggleStar(selected),
		open: () => selected?.link && window.open(selected.link, "_blank"),
		readAndNext,
		focusNotes: () => focusNotes(),
		focusSearch: () => document.getElementById("reader-search")?.focus(),
		back: () => (selectedId ? openItem(undefined) : undefined),
		palette: () => setPaletteOpen((v) => !v),
		help: () => setHelpOpen((v) => !v),
		refresh: () => refresh.mutate(undefined),
		addFeed: () => setShowAdd(true),
		markAll: requestMarkAll,
		view: setView,
		settings: () => navigate({ to: "/settings" }),
		sidebar: paneStore.toggleCollapsed,
		undo: () => {
			const last = undo.take();
			if (!last) return toast.info("Nothing to undo");
			last.run();
			toast.success(`Undid ${last.label}`);
		},
	});

	return (
		<div className="flex h-dvh overflow-hidden overflow-x-clip bg-background">
			<SidebarPane
				activeView={search.view ?? "unread"}
				onAddFeed={() => setShowAdd(true)}
				onHelp={() => setHelpOpen(true)}
			>
				<Sidebar
					activeView={search.view ?? "unread"}
					className="flex w-full"
					onAddFeed={() => setShowAdd(true)}
					onHelp={() => setHelpOpen(true)}
				/>
			</SidebarPane>
			<div
				className={cn(
					"flex w-full min-w-0 shrink-0 flex-col border-r md:w-(--pane-list)",
					selectedId && "hidden md:flex",
				)}
				style={listWidth}
			>
				<ItemList
					listInput={listInput}
					selectedId={selectedId}
					itemsQuery={itemsQuery}
					refresh={refresh}
					showAdd={showAdd}
					setShowAdd={setShowAdd}
					onOpenNav={() => setNavOpen(true)}
					unreadInView={unreadInView}
					confirmMarkAll={confirmMarkAll}
					setConfirmMarkAll={setConfirmMarkAll}
					requestMarkAll={requestMarkAll}
					doMarkAll={doMarkAll}
				/>
			</div>
			<ListHandle />
			<div
				className={cn(
					"min-w-0 flex-1 bg-card",
					!selectedId && "hidden md:block",
				)}
			>
				{selectedId ? (
					<ItemDetail
						key={selectedId}
						itemId={selectedId}
						hasPrev={hasPrev}
						hasNext={hasNext}
						onPrev={() => move(-1)}
						onNext={() => move(1)}
						onReadAndNext={readAndNext}
					/>
				) : (
					<EmptyDetail onPalette={() => setPaletteOpen(true)} />
				)}
			</div>
			{navOpen && (
				// biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss; Esc handled globally
				<div
					className="fixed inset-0 z-40 animate-[fade-in_150ms_ease-out] bg-black/40 md:hidden"
					onClick={() => setNavOpen(false)}
				>
					<div
						className="h-full w-72 max-w-[85vw] animate-[drawer-in_200ms_cubic-bezier(0.16,1,0.3,1)]"
						onClick={(e) => e.stopPropagation()}
					>
						<Sidebar
							activeView={search.view ?? "unread"}
							onNavigate={() => setNavOpen(false)}
							onAddFeed={() => {
								setNavOpen(false);
								setShowAdd(true);
							}}
							onHelp={() => {
								setNavOpen(false);
								setHelpOpen(true);
							}}
							className="flex h-full w-full"
						/>
					</div>
				</div>
			)}
			<Palette
				open={paletteOpen}
				onClose={() => setPaletteOpen(false)}
				selected={selected}
				onAddFeed={() => setShowAdd(true)}
				onMarkAll={requestMarkAll}
				unreadInView={unreadInView}
			/>
			<ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
		</div>
	);
}

/** Scrolls to and focuses the notes box of the open post, if any. */
export function focusNotes() {
	const el = document.querySelector<HTMLTextAreaElement>(
		"textarea[data-notes]",
	);
	if (!el) return;
	el.scrollIntoView({ block: "center", behavior: "smooth" });
	el.focus({ preventScroll: true });
}

function EmptyDetail({ onPalette }: { onPalette: () => void }) {
	return (
		<div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
			<p className="font-serif text-lg">{"Pick a post to read"}</p>
			<button
				type="button"
				onClick={onPalette}
				className="rounded-md border px-3 py-1.5 text-xs hover:bg-accent"
			>
				{"or press "}
				<kbd className="font-sans font-medium">{KEYS.palette}</kbd>
			</button>
		</div>
	);
}

// ── Sidebar ────────────────────────────────────────────────────────────────

const heading = (label: string) => (
	<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
		{label}
	</span>
);

function Sidebar({
	activeView,
	className,
	onNavigate,
	onAddFeed,
	onHelp,
}: {
	activeView: string;
	className?: string;
	onNavigate?: () => void;
	onAddFeed?: () => void;
	onHelp?: () => void;
}) {
	const feedsQuery = api.reader.useFeeds();
	const feeds = feedsQuery.data ?? [];
	const { data: tags = [] } = api.reader.useTags();
	const totalUnread = feeds.reduce((n, f) => n + f.unread, 0);
	const regular = feeds.filter((f) => !isNewsletter(f.url));
	const newsletters = feeds.filter((f) => isNewsletter(f.url));

	const row = (
		view: string,
		label: string,
		icon: React.ReactNode,
		badge?: number,
		kbd?: string,
	) => (
		<Link
			key={view}
			to="/reader"
			search={(prev: Search) => ({ ...prev, view, item: undefined })}
			onClick={onNavigate}
			className={cn(
				"flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent",
				activeView === view &&
					"bg-sidebar-accent font-medium text-sidebar-foreground",
			)}
			title={kbd}
		>
			{icon}
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{badge !== undefined && badge > 0 && (
				<span className="text-[11px] tabular-nums text-muted-foreground">
					{badge}
				</span>
			)}
		</Link>
	);

	return (
		<nav
			className={cn(
				"flex-col border-r border-sidebar-border bg-sidebar",
				className,
			)}
		>
			<div className="flex items-center gap-2 px-4 pb-2 pt-[max(1rem,env(safe-area-inset-top))]">
				<Rss className="h-4 w-4 text-primary" strokeWidth={2.5} />
				<span className="text-sm font-semibold tracking-tight">
					{"Feed Reader"}
				</span>
			</div>
			<div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-2.5">
				<div className="space-y-px">
					{row(
						"unread",
						"Unread",
						<Inbox className="h-4 w-4 text-muted-foreground" />,
						totalUnread,
						KEYS.unread,
					)}
					{row(
						"all",
						"All",
						<Layers className="h-4 w-4 text-muted-foreground" />,
						undefined,
						KEYS.all,
					)}
					{row(
						"starred",
						"Starred",
						<Star className="h-4 w-4 text-muted-foreground" />,
						undefined,
						KEYS.starred,
					)}
				</div>
				<div>
					<div className="flex items-center justify-between pb-1 pl-2.5 pr-1">
						{heading("Feeds")}
						{onAddFeed && (
							<Tip label="Add feed" kbd={KEYS.addFeed}>
								<button
									type="button"
									aria-label="Add feed"
									onClick={onAddFeed}
									className="rounded p-1 text-muted-foreground/70 hover:bg-sidebar-accent hover:text-foreground"
								>
									<Plus className="h-3.5 w-3.5" />
								</button>
							</Tip>
						)}
					</div>
					{feedsQuery.isError && !feedsQuery.data ? (
						<div className="px-2.5 py-2 text-xs text-muted-foreground">
							{"Couldn't reach the server. "}
							<button
								type="button"
								onClick={() => feedsQuery.refetch()}
								className="underline underline-offset-2 hover:text-foreground"
							>
								{"Try again"}
							</button>
						</div>
					) : feedsQuery.isSuccess && feeds.length === 0 ? (
						<div className="px-2.5 py-2 text-xs text-muted-foreground">
							<p className="font-serif">{"Nothing here yet."}</p>
							{onAddFeed && (
								<button
									type="button"
									onClick={onAddFeed}
									className="mt-1.5 rounded-md border border-input px-2 py-1 text-xs hover:bg-sidebar-accent"
								>
									{"Add your first feed"}
								</button>
							)}
						</div>
					) : (
						<div className="space-y-px">
							{regular.map((f) => (
								<FeedRow
									key={f.id}
									feed={f}
									active={activeView === `feed:${f.id}`}
									onNavigate={onNavigate}
								/>
							))}
						</div>
					)}
				</div>
				{newsletters.length > 0 && (
					<div>
						<div className="pb-1 pl-2.5">{heading("Newsletters")}</div>
						<div className="space-y-px">
							{newsletters.map((f) => (
								<FeedRow
									key={f.id}
									feed={f}
									active={activeView === `feed:${f.id}`}
									onNavigate={onNavigate}
								/>
							))}
						</div>
					</div>
				)}
				{tags.length > 0 && (
					<div>
						<div className="pb-1 pl-2.5">{heading("Tags")}</div>
						<div className="space-y-px">
							{tags.map((t) =>
								row(
									`tag:${t}`,
									t,
									<Tag className="h-4 w-4 shrink-0 text-muted-foreground" />,
								),
							)}
						</div>
					</div>
				)}
			</div>
			<SidebarFooter onHelp={onHelp} />
		</nav>
	);
}

/** One feed in the sidebar, with the per-feed menu on right-click, long-press or the "…" button. */
function FeedRow({
	feed,
	active,
	onNavigate,
}: {
	feed: ReaderFeed;
	active: boolean;
	onNavigate?: () => void;
}) {
	const [confirmUnsub, setConfirmUnsub] = useState(false);
	const markAll = useMarkAllWithUndo();
	const updateFeed = api.reader.useUpdateFeed({
		onError: (e) => toast.error(e.message),
	});
	const removeFeed = api.reader.useRemoveFeed({
		onSuccess: () => toast.success(`Unsubscribed from ${feed.title}`),
	});
	const actions: MenuAction[] = [
		{
			label: "Mark feed as read",
			icon: <CheckCheck />,
			disabled: feed.unread === 0,
			onSelect: () =>
				markAll.run({ kind: "feed", feedId: feed.id }, feed.title),
		},
		{
			label: "Copy feed URL",
			icon: <Copy />,
			onSelect: async () => {
				await navigator.clipboard.writeText(feed.url);
				toast.success("Feed URL copied");
			},
		},
		{
			label: "Open site",
			icon: <ExternalLink />,
			disabled: !feed.siteUrl,
			onSelect: () => feed.siteUrl && window.open(feed.siteUrl, "_blank"),
		},
		{
			label: feed.enabled ? "Pause" : "Resume",
			icon: feed.enabled ? <Pause /> : <Play />,
			onSelect: () =>
				updateFeed.mutate({ feedId: feed.id, enabled: !feed.enabled }),
		},
		{
			label: "Unsubscribe",
			icon: <Trash2 />,
			destructive: true,
			onSelect: () => setConfirmUnsub(true),
		},
	];

	return (
		<ConfirmPopover
			open={confirmUnsub}
			onOpenChange={setConfirmUnsub}
			question={`Unsubscribe from ${feed.title}? This deletes its posts, including your notes and tags on them.`}
			confirmLabel="Unsubscribe"
			onConfirm={() => removeFeed.mutate({ feedId: feed.id })}
		>
			<div className="group relative">
				<ContextActions actions={actions}>
					<Link
						to="/reader"
						search={(prev: Search) => ({
							...prev,
							view: `feed:${feed.id}`,
							item: undefined,
						})}
						onClick={onNavigate}
						className={cn(
							"flex items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-8 text-[13px] text-sidebar-foreground/90 hover:bg-sidebar-accent",
							active && "bg-sidebar-accent font-medium text-sidebar-foreground",
							!feed.enabled && "text-muted-foreground",
						)}
					>
						<FeedIcon url={feed.url} />
						<span className="min-w-0 flex-1 truncate">{feed.title}</span>
						{feed.unread > 0 && (
							<span className="text-[11px] tabular-nums text-muted-foreground group-focus-within:hidden group-hover:hidden">
								{feed.unread}
							</span>
						)}
					</Link>
				</ContextActions>
				<div className="absolute right-1 top-1/2 -translate-y-1/2 opacity-0 focus-within:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100">
					<Menu
						actions={actions}
						trigger={
							<button
								type="button"
								aria-label={`Actions for ${feed.title}`}
								className="rounded p-1 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
							>
								<MoreHorizontal className="h-3.5 w-3.5" />
							</button>
						}
					/>
				</div>
			</div>
		</ConfirmPopover>
	);
}

export function SidebarFooter({
	onHelp,
	stacked,
}: {
	onHelp?: () => void;
	/** Vertical layout for the collapsed icon rail. */
	stacked?: boolean;
}) {
	const { resolvedTheme, setTheme } = useTheme();
	const navigate = useNavigate();
	const btn =
		"rounded-md p-2 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground";
	return (
		<div
			className={cn(
				"flex items-center gap-1 border-t border-sidebar-border p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]",
				stacked && "w-full flex-col",
			)}
		>
			<Tip label="Settings" kbd={KEYS.settings} side="top">
				<Link to="/settings" aria-label="Settings" className={btn}>
					<SettingsIcon className="h-4 w-4" />
				</Link>
			</Tip>
			<Tip label="Toggle theme" side="top">
				<button
					type="button"
					aria-label="Toggle theme"
					onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
					className={btn}
				>
					<Sun className="h-4 w-4 dark:hidden" />
					<Moon className="hidden h-4 w-4 dark:block" />
				</button>
			</Tip>
			{onHelp && (
				<Tip label="Keyboard shortcuts" kbd={KEYS.help} side="top">
					<button
						type="button"
						aria-label="Keyboard shortcuts"
						onClick={onHelp}
						className={btn}
					>
						<CircleHelp className="h-4 w-4" />
					</button>
				</Tip>
			)}
			<div className="flex-1" />
			<Tip label="Sign out" side="top">
				<button
					type="button"
					aria-label="Sign out"
					onClick={async () => {
						await signOut();
						navigate({ to: "/sign-in" });
					}}
					className={btn}
				>
					<LogOut className="h-4 w-4" />
				</button>
			</Tip>
		</div>
	);
}

// ── List pane ──────────────────────────────────────────────────────────────

function ItemList({
	listInput,
	selectedId,
	itemsQuery,
	refresh,
	showAdd,
	setShowAdd,
	onOpenNav,
	unreadInView,
	confirmMarkAll,
	setConfirmMarkAll,
	requestMarkAll,
	doMarkAll,
}: {
	listInput: ListInput;
	selectedId?: string;
	itemsQuery: ReturnType<typeof api.reader.useItems>;
	refresh: ReturnType<typeof useRefreshWithToast>;
	showAdd: boolean;
	setShowAdd: React.Dispatch<React.SetStateAction<boolean>>;
	onOpenNav: () => void;
	unreadInView: number;
	confirmMarkAll: boolean;
	setConfirmMarkAll: (open: boolean) => void;
	requestMarkAll: () => void;
	doMarkAll: () => void;
}) {
	const search = Route.useSearch();
	const viewLabel = useViewLabel();
	const feedsQuery = api.reader.useFeeds();
	const feeds = feedsQuery.data ?? [];
	const totalUnread = feeds.reduce((n, f) => n + f.unread, 0);
	const online = useOnline();
	const pruneRead = api.reader.usePruneReadFromUnread();
	const items = itemsQuery.data ?? [];
	const firstRun = feedsQuery.isSuccess && feeds.length === 0;
	const stale =
		!online || (itemsQuery.isError && itemsQuery.data !== undefined);
	const markAllLabel =
		unreadInView > 0
			? `Mark ${unreadInView.toLocaleString()} as read`
			: "Mark all as read";

	const unreadBadge = listInput.filter.kind === "unread" && totalUnread > 0 && (
		<span className="text-xs tabular-nums text-muted-foreground">
			{totalUnread}
		</span>
	);

	return (
		<>
			<div className="shrink-0 border-b pt-[env(safe-area-inset-top)]">
				<div className="flex h-12 items-center gap-1 pl-3 pr-2">
					<button
						type="button"
						onClick={onOpenNav}
						aria-label="Open navigation"
						className="-ml-1 flex min-w-0 flex-1 items-center gap-2.5 rounded-md py-1.5 pl-1 md:hidden"
					>
						<MenuIcon className="h-5 w-5 shrink-0 text-muted-foreground" />
						<span className="truncate text-[15px] font-semibold tracking-tight">
							{viewLabel}
						</span>
						{unreadBadge}
					</button>
					<div className="hidden min-w-0 flex-1 items-baseline gap-2 md:flex">
						<h2 className="truncate text-[15px] font-semibold tracking-tight">
							{viewLabel}
						</h2>
						{unreadBadge}
					</div>
					<SidebarToggle />
					<IconButton
						label="Add feed"
						kbd={KEYS.addFeed}
						onClick={() => setShowAdd((v) => !v)}
					>
						<Plus className="h-4 w-4" />
					</IconButton>
					<ConfirmPopover
						open={confirmMarkAll}
						onOpenChange={setConfirmMarkAll}
						question={`Mark ${unreadInView.toLocaleString()} posts as read?`}
						onConfirm={doMarkAll}
					>
						<div className="hidden md:block">
							<IconButton
								label={markAllLabel}
								kbd={KEYS.markAll}
								onClick={requestMarkAll}
								disabled={unreadInView === 0}
							>
								<CheckCheck className="h-4 w-4" />
							</IconButton>
						</div>
					</ConfirmPopover>
					<div className="hidden md:block">
						<IconButton
							label="Refresh"
							kbd={KEYS.refresh}
							onClick={() => refresh.mutate(undefined)}
							disabled={refresh.isPending}
						>
							<RefreshCw
								className={cn("h-4 w-4", refresh.isPending && "animate-spin")}
							/>
						</IconButton>
					</div>
					<div className="md:hidden">
						<Menu
							actions={[
								{
									label: markAllLabel,
									icon: <CheckCheck />,
									disabled: unreadInView === 0,
									onSelect: requestMarkAll,
								},
								{
									label: "Refresh",
									icon: <RefreshCw />,
									disabled: refresh.isPending,
									onSelect: () => refresh.mutate(undefined),
								},
							]}
							trigger={
								<button
									type="button"
									aria-label="More actions"
									className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
								>
									<MoreHorizontal className="h-4 w-4" />
								</button>
							}
						/>
					</div>
				</div>
				{/* Keyed by the URL query so an outside change (palette search)
				    resets the input's local draft; typing never changes the key. */}
				<SearchForm key={search.q ?? ""} q={search.q} />
				{showAdd && (
					<div className="px-3 pb-3">
						<AddFeedForm onDone={() => setShowAdd(false)} />
					</div>
				)}
			</div>
			{stale && (
				<div className="flex shrink-0 items-center gap-2 border-b bg-accent/60 px-3 py-1.5 text-xs text-muted-foreground">
					<WifiOff className="h-3.5 w-3.5 shrink-0" />
					<span className="flex-1">{"Offline: showing what was loaded"}</span>
					<button
						type="button"
						onClick={() => itemsQuery.refetch()}
						className="underline underline-offset-2 hover:text-foreground"
					>
						{"Retry"}
					</button>
				</div>
			)}
			<div className="min-h-0 flex-1 overflow-y-auto pb-[env(safe-area-inset-bottom)]">
				{firstRun ? (
					<FirstRun />
				) : itemsQuery.isLoading ? (
					<ListSkeleton />
				) : itemsQuery.isError && itemsQuery.data === undefined ? (
					<div className="px-6 py-16 text-center">
						<WifiOff className="mx-auto h-5 w-5 text-muted-foreground/70" />
						<p className="mt-3 font-serif text-base text-muted-foreground">
							{"Couldn't reach the server"}
						</p>
						<button
							type="button"
							onClick={() => itemsQuery.refetch()}
							disabled={itemsQuery.isFetching}
							className="mt-3 rounded-md border border-input px-3 py-1.5 text-xs hover:bg-accent disabled:opacity-50"
						>
							{itemsQuery.isFetching ? "Trying…" : "Try again"}
						</button>
					</div>
				) : items.length === 0 ? (
					<div className="px-6 py-16 text-center">
						<p className="font-serif text-base text-muted-foreground">
							{listInput.search
								? `No posts match "${listInput.search}"`
								: listInput.filter.kind === "unread"
									? "Inbox zero. Go outside."
									: "Nothing here."}
						</p>
					</div>
				) : (
					<ul aria-label="Posts">
						{items.map((item) => (
							<ItemRow
								key={item.id}
								item={item}
								selected={item.id === selectedId}
								onSelect={() => pruneRead(listInput, item.id)}
							/>
						))}
					</ul>
				)}
			</div>
		</>
	);
}

const SUGGESTED_FEEDS = [
	{
		title: "Simon Willison",
		url: "https://simonwillison.net/atom/everything/",
	},
	{ title: "Armin Ronacher", url: "https://lucumr.pocoo.org/feed.xml" },
];

/** Empty-account onboarding: shown in the list pane until the first feed exists. */
function FirstRun() {
	const { data: inbound } = api.reader.useInboundAddress();
	const subscribe = useSubscribeAndOpen();
	const [busy, setBusy] = useState<string | null>(null);
	return (
		<div className="px-5 py-10">
			<h3 className="font-serif text-lg">{"Add your first feed"}</h3>
			<p className="mt-1 text-[13px] text-muted-foreground">
				{"Paste a site or feed URL. Or start with one of these."}
			</p>
			<div className="mt-4">
				<AddFeedForm />
			</div>
			<div className="mt-4 space-y-1.5">
				{SUGGESTED_FEEDS.map((s) => (
					<button
						key={s.url}
						type="button"
						disabled={busy !== null}
						onClick={() => {
							setBusy(s.url);
							subscribe.mutate(
								{ url: s.url },
								{ onSettled: () => setBusy(null) },
							);
						}}
						className="flex w-full items-center gap-2.5 rounded-md border border-input px-3 py-2 text-left text-[13px] hover:bg-accent disabled:opacity-50"
					>
						<Rss className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1 truncate">{s.title}</span>
						<span className="text-xs text-muted-foreground">
							{busy === s.url ? "Adding…" : "Subscribe"}
						</span>
					</button>
				))}
				{inbound?.domain && (
					<Link
						to="/settings"
						className="flex w-full items-center gap-2.5 rounded-md border border-input px-3 py-2 text-left text-[13px] hover:bg-accent"
					>
						<Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
						<span className="min-w-0 flex-1">
							{"Subscribe a newsletter with "}
							<span className="font-mono text-xs">{`anything@${inbound.domain}`}</span>
						</span>
					</Link>
				)}
			</div>
			<div className="mt-4">
				<OpmlImportButton className="inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs hover:bg-accent" />
			</div>
		</div>
	);
}

/** File picker that reads an OPML client-side and imports it. */
export function OpmlImportButton({ className }: { className?: string }) {
	const importOpml = api.reader.useImportOpml({
		onSuccess: (r) => {
			const res = r as {
				added: number;
				skipped: number;
				failed: Array<{ url: string }>;
			};
			const parts = [`${res.added} added`];
			if (res.skipped) parts.push(`${res.skipped} already subscribed`);
			if (res.failed.length) parts.push(`${res.failed.length} failed`);
			(res.failed.length && res.added === 0 ? toast.error : toast.success)(
				"OPML imported",
				{ description: parts.join(" · ") },
			);
		},
		onError: (e) => toast.error(e.message),
	});
	return (
		<label className={cn(className, "cursor-pointer")}>
			<FileUp className="h-3.5 w-3.5" />
			{importOpml.isPending ? "Importing…" : "Import OPML…"}
			<input
				type="file"
				accept=".opml,.xml,text/xml,application/xml,text/x-opml"
				className="sr-only"
				disabled={importOpml.isPending}
				onChange={async (e) => {
					const file = e.target.files?.[0];
					e.target.value = "";
					if (!file) return;
					importOpml.mutate({ xml: await file.text() });
				}}
			/>
		</label>
	);
}

function ListSkeleton() {
	return (
		<div className="space-y-px">
			{Array.from({ length: 9 }, (_, i) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: static skeleton
				<div key={i} className="animate-pulse space-y-2 px-4 py-3.5">
					<div className="h-3.5 w-4/5 rounded bg-accent" />
					<div className="h-3 w-1/2 rounded bg-accent/70" />
				</div>
			))}
		</div>
	);
}

function scrollRowIntoView(el: HTMLElement | null) {
	el?.scrollIntoView({ block: "nearest" });
}

function ItemRow({
	item,
	selected,
	onSelect,
}: {
	item: ReaderItem;
	selected: boolean;
	onSelect: () => void;
}) {
	const unread = item.readAt === null;
	return (
		<li ref={selected ? scrollRowIntoView : undefined}>
			<Link
				to="/reader"
				search={(prev: Search) => ({ ...prev, item: item.id })}
				onClick={onSelect}
				className={cn(
					"flex gap-2.5 border-b border-border/60 py-3 pl-3 pr-4 hover:bg-accent/50",
					selected && "bg-accent",
				)}
			>
				<span className="flex w-2.5 shrink-0 justify-center pt-[7px]">
					{unread && <span className="h-2 w-2 rounded-full bg-unread" />}
				</span>
				<span className="min-w-0 flex-1">
					<span
						className={cn(
							"block truncate text-[14px] leading-snug",
							unread ? "font-medium" : "text-muted-foreground",
						)}
					>
						{item.title}
					</span>
					<span className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground/80">
						{item.starred && (
							<Star className="h-3 w-3 shrink-0 fill-star text-star" />
						)}
						<span className="truncate">{item.feedTitle}</span>
						<span aria-hidden>{"·"}</span>
						<span className="shrink-0 tabular-nums">
							{relative(item.publishedAt)}
						</span>
					</span>
				</span>
			</Link>
		</li>
	);
}

function SearchForm({ q }: { q?: string }) {
	const navigate = useNavigate({ from: Route.fullPath });
	const [query, setQuery] = useState(q ?? "");
	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				navigate({
					search: (prev: Search) => ({ ...prev, q: query || undefined }),
				});
			}}
			className="relative px-3 pb-2.5"
		>
			<SearchIcon className="pointer-events-none absolute left-5.5 top-2 h-4 w-4 text-muted-foreground" />
			<input
				id="reader-search"
				value={query}
				onChange={(e) => setQuery(e.target.value)}
				placeholder="Search"
				className="h-8 w-full rounded-md border-none bg-accent/70 pl-8 pr-8 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40"
			/>
			{q && (
				<button
					type="button"
					aria-label="Clear search"
					onClick={() => {
						setQuery("");
						navigate({ search: (prev: Search) => ({ ...prev, q: undefined }) });
					}}
					className="absolute right-5 top-2 text-muted-foreground hover:text-foreground"
				>
					<X className="h-4 w-4" />
				</button>
			)}
		</form>
	);
}

function focusOnMount(el: HTMLInputElement | null) {
	el?.focus();
}

/** Subscribe, then land on the new feed with an unread count in the toast. */
function useSubscribeAndOpen(onDone?: () => void) {
	const navigate = useNavigate();
	return api.reader.useSubscribe({
		onSuccess: (data) => {
			const feed = data as ReaderFeed;
			toast.success(`Subscribed to ${feed.title} · ${feed.unread} unread`);
			navigate({
				to: "/reader",
				search: { view: `feed:${feed.id}` },
			});
			onDone?.();
		},
		onError: (e) =>
			toast.error(
				e.message === "Input validation failed"
					? "Enter a valid URL"
					: e.message,
			),
	});
}

export function AddFeedForm({ onDone }: { onDone?: () => void }) {
	const [url, setUrl] = useState("");
	const subscribe = useSubscribeAndOpen(() => {
		setUrl("");
		onDone?.();
	});
	return (
		<form
			className="flex gap-2"
			onSubmit={(e) => {
				e.preventDefault();
				const raw = url.trim();
				if (!raw) return;
				// Accept a bare host ("lethain.com") and refuse anything that
				// still isn't a URL before the server's validator does, tersely.
				const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw)
					? raw
					: `https://${raw}`;
				let parsed: URL | null = null;
				try {
					parsed = new URL(withScheme);
				} catch {
					/* not a URL */
				}
				if (!parsed || /\s/.test(raw) || !/^https?:$/.test(parsed.protocol)) {
					toast.error("Enter a valid URL");
					return;
				}
				subscribe.mutate({ url: parsed.href });
			}}
		>
			<input
				ref={focusOnMount}
				value={url}
				onChange={(e) => setUrl(e.target.value)}
				placeholder="Feed or site URL"
				className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm"
				required
			/>
			<button
				type="submit"
				disabled={subscribe.isPending}
				className="h-8 shrink-0 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
			>
				{subscribe.isPending ? "Adding…" : "Add"}
			</button>
		</form>
	);
}

// ── Shared bits ────────────────────────────────────────────────────────────

export function IconButton({
	label,
	kbd,
	onClick,
	disabled,
	children,
}: {
	label: string;
	kbd?: string;
	onClick?: () => void;
	disabled?: boolean;
	children: React.ReactNode;
}) {
	return (
		<Tip label={label} kbd={kbd}>
			<button
				type="button"
				aria-label={label}
				onClick={onClick}
				disabled={disabled}
				className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 disabled:opacity-50"
			>
				{children}
			</button>
		</Tip>
	);
}

export function BackToList() {
	const listInput = useListInput();
	const pruneRead = api.reader.usePruneReadFromUnread();
	return (
		<Link
			to="/reader"
			search={(prev: Search) => ({ ...prev, item: undefined })}
			onClick={() => pruneRead(listInput)}
			className="-ml-1 flex items-center gap-0.5 rounded-md py-1.5 pl-1 pr-2 text-sm text-muted-foreground hover:text-foreground md:hidden"
		>
			<ChevronLeft className="h-4.5 w-4.5" />
			{"List"}
		</Link>
	);
}

export function relative(date: Date | null): string {
	if (!date) return "";
	const s = Math.max(0, (Date.now() - date.getTime()) / 1000);
	if (s < 60) return "now";
	if (s < 3600) return `${Math.floor(s / 60)}m`;
	if (s < 86400) return `${Math.floor(s / 3600)}h`;
	if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
	if (s < 86400 * 365) return `${Math.floor(s / 86400 / 30)}mo`;
	return `${Math.floor(s / 86400 / 365)}y`;
}
