import type { ReaderItem } from "@feedreader/api";
import { useNavigate } from "@tanstack/react-router";
import { Command } from "cmdk";
import {
	CheckCheck,
	ExternalLink,
	FileText,
	Inbox,
	Layers,
	Mail,
	MailOpen,
	Moon,
	PanelLeft,
	PenLine,
	Plus,
	RefreshCw,
	Search as SearchIcon,
	Settings as SettingsIcon,
	Star,
	Sun,
	Tag,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useDeferredValue, useMemo, useState } from "react";
import { FeedIcon } from "@/components/shared/feed-icon";
import { paneStore } from "@/hooks/use-pane-sizes";
import { api } from "@/lib/api";
import {
	focusNotes,
	relative,
	useItemActions,
	useListInput,
	useRefreshWithToast,
} from "../reader";
import { KEYS, Kbd } from "./shortcuts";

const label = (text: string, key?: string) => (
	<>
		<span className="min-w-0 flex-1 truncate">{text}</span>
		{key && <Kbd>{key}</Kbd>}
	</>
);

export function Palette({
	open,
	onClose,
	selected,
	onAddFeed,
	onMarkAll,
	unreadInView,
}: {
	open: boolean;
	onClose: () => void;
	selected?: ReaderItem;
	onAddFeed: () => void;
	onMarkAll: () => void;
	unreadInView: number;
}) {
	if (!open) return null;
	return (
		<PaletteInner
			onClose={onClose}
			selected={selected}
			onAddFeed={onAddFeed}
			onMarkAll={onMarkAll}
			unreadInView={unreadInView}
		/>
	);
}

function PaletteInner({
	onClose,
	selected,
	onAddFeed,
	onMarkAll,
	unreadInView,
}: {
	onClose: () => void;
	selected?: ReaderItem;
	onAddFeed: () => void;
	onMarkAll: () => void;
	unreadInView: number;
}) {
	const [query, setQuery] = useState("");
	const navigate = useNavigate();
	const listInput = useListInput();
	const { data: feeds = [] } = api.reader.useFeeds();
	const { data: tags = [] } = api.reader.useTags();
	const actions = useItemActions(listInput);
	const refresh = useRefreshWithToast();
	const { resolvedTheme, setTheme } = useTheme();

	// Global post search across every feed — deferred so a fast typist doesn't
	// fire a server query per keystroke.
	const postQuery = useDeferredValue(query.trim());
	const postSearchInput = useMemo(
		() => ({ filter: { kind: "all" } as const, search: postQuery, limit: 8 }),
		[postQuery],
	);
	const { data: posts = [] } = api.reader.useItems(postSearchInput, {
		enabled: postQuery.length >= 2,
	});

	const pruneRead = api.reader.usePruneReadFromUnread();

	const openPost = (id: string) => {
		pruneRead(listInput, id);
		navigate({
			to: "/reader",
			search: (prev: Record<string, unknown>) => ({ ...prev, item: id }),
		});
		onClose();
	};

	const go = (view?: string, q?: string) => {
		navigate({
			to: "/reader",
			search: (prev: Record<string, unknown>) => ({
				...prev,
				...(view !== undefined ? { view, item: undefined } : {}),
				...(q !== undefined ? { q: q || undefined } : {}),
			}),
		});
		onClose();
	};
	const run = (fn: () => void) => {
		fn();
		onClose();
	};

	const itemClass =
		"flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] aria-selected:bg-accent";
	const headingClass =
		"px-2.5 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80";
	const icon = "h-4 w-4 shrink-0 text-muted-foreground";
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss; Esc handled globally
		<div
			className="fixed inset-0 z-50 bg-black/40 p-4 pt-[12vh]"
			onClick={onClose}
		>
			<Command
				label="Command palette"
				className="mx-auto w-full max-w-lg overflow-hidden rounded-xl border bg-popover shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<Command.Input
					autoFocus
					value={query}
					onValueChange={setQuery}
					placeholder="Jump to, act on, or search…"
					className="w-full border-b bg-transparent px-4 py-3 text-sm outline-none placeholder:text-muted-foreground/70"
				/>
				<Command.List className="max-h-[50vh] overflow-y-auto p-1.5">
					<Command.Empty className="px-2.5 py-6 text-center text-sm text-muted-foreground">
						{query ? (
							<button
								type="button"
								className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent"
								onClick={() => go(undefined, query)}
							>
								<SearchIcon className="mr-1.5 inline h-3.5 w-3.5" />
								{`Search posts for "${query}"`}
							</button>
						) : (
							"Nothing here."
						)}
					</Command.Empty>

					{selected && (
						<Command.Group
							heading="This post"
							className="[&_[cmdk-group-heading]]:hidden"
						>
							<div className={headingClass}>{"This post"}</div>
							<Command.Item
								className={itemClass}
								onSelect={() => run(() => actions.toggleStar(selected))}
							>
								<Star className={icon} />
								{label(selected.starred ? "Unstar" : "Star", KEYS.toggleStar)}
							</Command.Item>
							<Command.Item
								className={itemClass}
								onSelect={() => run(() => actions.toggleRead(selected))}
							>
								{selected.readAt ? (
									<Mail className={icon} />
								) : (
									<MailOpen className={icon} />
								)}
								{label(
									selected.readAt ? "Mark as unread" : "Mark as read",
									KEYS.toggleRead,
								)}
							</Command.Item>
							<Command.Item
								className={itemClass}
								onSelect={() => run(focusNotes)}
							>
								<PenLine className={icon} />
								{label("Write a note", KEYS.notes)}
							</Command.Item>
							{selected.link && (
								<Command.Item
									className={itemClass}
									onSelect={() =>
										run(() => window.open(selected.link ?? "", "_blank"))
									}
								>
									<ExternalLink className={icon} />
									{label("Open in browser", KEYS.open)}
								</Command.Item>
							)}
						</Command.Group>
					)}

					{posts.length > 0 && (
						<Command.Group className="[&_[cmdk-group-heading]]:hidden">
							<div className={headingClass}>{"Posts"}</div>
							{posts.map((p) => (
								<Command.Item
									key={p.id}
									// Prefixing the live query guarantees cmdk's filter keeps
									// server-matched posts visible whatever its fuzzy score.
									value={`${query} post ${p.title} ${p.id}`}
									className={itemClass}
									onSelect={() => openPost(p.id)}
								>
									<FileText className={icon} />
									<span className="min-w-0 flex-1 truncate">{p.title}</span>
									<span className="shrink-0 text-[11px] text-muted-foreground">
										{[p.feedTitle, relative(p.publishedAt)]
											.filter(Boolean)
											.join(" · ")}
									</span>
								</Command.Item>
							))}
						</Command.Group>
					)}

					<Command.Group className="[&_[cmdk-group-heading]]:hidden">
						<div className={headingClass}>{"Views"}</div>
						<Command.Item className={itemClass} onSelect={() => go("unread")}>
							<Inbox className={icon} />
							{label("Unread", KEYS.unread)}
						</Command.Item>
						<Command.Item className={itemClass} onSelect={() => go("all")}>
							<Layers className={icon} />
							{label("All", KEYS.all)}
						</Command.Item>
						<Command.Item className={itemClass} onSelect={() => go("starred")}>
							<Star className={icon} />
							{label("Starred", KEYS.starred)}
						</Command.Item>
					</Command.Group>

					{feeds.length > 0 && (
						<Command.Group className="[&_[cmdk-group-heading]]:hidden">
							<div className={headingClass}>{"Feeds"}</div>
							{feeds.map((f) => (
								<Command.Item
									key={f.id}
									value={`feed ${f.title}`}
									className={itemClass}
									onSelect={() => go(`feed:${f.id}`)}
								>
									<FeedIcon url={f.url} className={icon} />
									<span className="min-w-0 flex-1 truncate">{f.title}</span>
									{f.unread > 0 && (
										<span className="text-[11px] tabular-nums text-muted-foreground">
											{f.unread}
										</span>
									)}
								</Command.Item>
							))}
						</Command.Group>
					)}

					{tags.length > 0 && (
						<Command.Group className="[&_[cmdk-group-heading]]:hidden">
							<div className={headingClass}>{"Tags"}</div>
							{tags.map((t) => (
								<Command.Item
									key={t}
									value={`tag ${t}`}
									className={itemClass}
									onSelect={() => go(`tag:${t}`)}
								>
									<Tag className={icon} />
									{`#${t}`}
								</Command.Item>
							))}
						</Command.Group>
					)}

					<Command.Group className="[&_[cmdk-group-heading]]:hidden">
						<div className={headingClass}>{"Actions"}</div>
						<Command.Item
							className={itemClass}
							onSelect={() => run(() => refresh.mutate(undefined))}
						>
							<RefreshCw className={icon} />
							{label("Refresh feeds", KEYS.refresh)}
						</Command.Item>
						<Command.Item className={itemClass} onSelect={() => run(onAddFeed)}>
							<Plus className={icon} />
							{label("Add feed", KEYS.addFeed)}
						</Command.Item>
						<Command.Item
							className={itemClass}
							disabled={unreadInView === 0}
							onSelect={() => run(onMarkAll)}
						>
							<CheckCheck className={icon} />
							{label(
								unreadInView > 0
									? `Mark ${unreadInView.toLocaleString()} as read`
									: "Mark all as read",
								KEYS.markAll,
							)}
						</Command.Item>
						<Command.Item
							className={itemClass}
							onSelect={() =>
								run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))
							}
						>
							<Sun className="h-4 w-4 shrink-0 text-muted-foreground dark:hidden" />
							<Moon className="hidden h-4 w-4 shrink-0 text-muted-foreground dark:block" />
							{label("Toggle theme")}
						</Command.Item>
						<Command.Item
							className={itemClass}
							onSelect={() => run(paneStore.toggleCollapsed)}
						>
							<PanelLeft className={icon} />
							{label("Toggle sidebar", KEYS.sidebar)}
						</Command.Item>
						<Command.Item
							className={itemClass}
							onSelect={() => run(() => navigate({ to: "/settings" }))}
						>
							<SettingsIcon className={icon} />
							{label("Settings", KEYS.settings)}
						</Command.Item>
					</Command.Group>
				</Command.List>
			</Command>
		</div>
	);
}
