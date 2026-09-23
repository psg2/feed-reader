import { useEffectEvent } from "react";
import { useMountEffect } from "@/hooks/use-mount-effect";

type Handlers = {
	overlayOpen: boolean;
	closeOverlays: () => void;
	next: () => void;
	prev: () => void;
	toggleRead: () => void;
	toggleStar: () => void;
	open: () => void;
	readAndNext: () => void;
	focusNotes: () => void;
	focusSearch: () => void;
	back: () => void;
	palette: () => void;
	help: () => void;
	refresh: () => void;
	addFeed: () => void;
	markAll: () => void;
	view: (view: "unread" | "all" | "starred") => void;
	settings: () => void;
	sidebar: () => void;
	undo: () => void;
};

function isEditable(target: EventTarget | null): boolean {
	return (
		target instanceof HTMLElement &&
		target.closest("input, textarea, select, [contenteditable]") !== null
	);
}

/** Global reader shortcuts, mirroring the macOS app (see docs/shortcuts.md).
 * Mounted once; the Effect Event reads the latest handlers so the listener
 * never re-subscribes. */
export function useReaderShortcuts(handlers: Handlers) {
	const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
		const h = handlers;
		const mod = e.metaKey || e.ctrlKey;
		const key = e.key.toLowerCase();

		if (mod && !e.altKey) {
			const cmd: Record<string, (() => void) | undefined> = {
				k: e.shiftKey ? h.markAll : h.palette,
				"1": () => h.view("unread"),
				"2": () => h.view("all"),
				"3": () => h.view("starred"),
				",": h.settings,
				"\\": h.sidebar,
			};
			const fn = cmd[key];
			if (fn) {
				e.preventDefault();
				fn();
			}
			return;
		}
		if (e.key === "Escape") {
			if (h.overlayOpen) {
				h.closeOverlays();
				return;
			}
			if (isEditable(e.target)) {
				(e.target as HTMLElement).blur();
				return;
			}
			h.back();
			return;
		}
		if (e.altKey || isEditable(e.target) || h.overlayOpen) return;

		const act: Record<string, () => void> = {
			j: h.next,
			k: h.prev,
			e: h.readAndNext,
			u: h.toggleRead,
			s: h.toggleStar,
			o: h.open,
			n: h.focusNotes,
			"/": h.focusSearch,
			"?": h.help,
			a: h.addFeed,
			r: h.refresh,
			z: h.undo,
		};
		const fn = act[e.key];
		if (fn) {
			e.preventDefault();
			fn();
		}
	});

	useMountEffect(() => {
		const listener = (e: KeyboardEvent) => onKeyDown(e);
		window.addEventListener("keydown", listener);
		return () => window.removeEventListener("keydown", listener);
	});
}

/** Key labels shared by the help sheet, tooltips and the palette chips. */
export const KEYS = {
	next: "j",
	prev: "k",
	readAndNext: "e",
	toggleRead: "u",
	toggleStar: "s",
	open: "o",
	notes: "n",
	search: "/",
	back: "Esc",
	help: "?",
	addFeed: "a",
	refresh: "r",
	undo: "z",
	palette: "⌘K",
	markAll: "⇧⌘K",
	unread: "⌘1",
	all: "⌘2",
	starred: "⌘3",
	settings: "⌘,",
	sidebar: "⌘\\",
} as const;

const GROUPS: Array<{ title: string; keys: Array<[string, string]> }> = [
	{
		title: "Navigate",
		keys: [
			[KEYS.next, "Next post"],
			[KEYS.prev, "Previous post"],
			[KEYS.back, "Back to list"],
			[KEYS.search, "Search"],
			[KEYS.unread, "Unread"],
			[KEYS.all, "All"],
			[KEYS.starred, "Starred"],
		],
	},
	{
		title: "Act",
		keys: [
			[KEYS.readAndNext, "Mark read, go next"],
			[KEYS.toggleRead, "Toggle read"],
			[KEYS.toggleStar, "Toggle star"],
			[KEYS.open, "Open in browser"],
			[KEYS.notes, "Write a note"],
			[KEYS.markAll, "Mark all as read"],
			[KEYS.undo, "Undo last mark"],
			[KEYS.addFeed, "Add feed"],
			[KEYS.refresh, "Refresh feeds"],
		],
	},
	{
		title: "Everywhere",
		keys: [
			[KEYS.palette, "Command palette"],
			[KEYS.sidebar, "Toggle sidebar"],
			[KEYS.settings, "Settings"],
			[KEYS.help, "This help"],
		],
	},
];

export function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="rounded border bg-accent px-1.5 py-0.5 font-sans text-[11px] font-medium">
			{children}
		</kbd>
	);
}

export function ShortcutsHelp({
	open,
	onClose,
}: {
	open: boolean;
	onClose: () => void;
}) {
	if (!open) return null;
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismiss; Esc handled globally
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
			onClick={onClose}
		>
			<div
				role="dialog"
				aria-label="Keyboard shortcuts"
				className="max-h-[85vh] w-full max-w-sm overflow-y-auto rounded-xl border bg-popover p-5 shadow-xl"
				onClick={(e) => e.stopPropagation()}
			>
				<h2 className="mb-4 text-sm font-semibold tracking-tight">
					{"Keyboard shortcuts"}
				</h2>
				<div className="space-y-4">
					{GROUPS.map((g) => (
						<div key={g.title}>
							<div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
								{g.title}
							</div>
							<dl className="space-y-1">
								{g.keys.map(([key, label]) => (
									<div
										key={key}
										className="flex items-center justify-between text-[13px]"
									>
										<dt className="text-muted-foreground">{label}</dt>
										<dd>
											<Kbd>{key}</Kbd>
										</dd>
									</div>
								))}
							</dl>
						</div>
					))}
				</div>
				<p className="mt-4 text-[11px] text-muted-foreground">
					{"On Windows and Linux, ⌘ is Ctrl."}
				</p>
			</div>
		</div>
	);
}
