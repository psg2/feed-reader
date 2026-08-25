import DOMPurify, { type Config } from "dompurify";
import {
	ChevronLeft,
	ChevronRight,
	CircleCheck,
	ExternalLink,
	Mail,
	MailOpen,
	PenLine,
	Star,
	X,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import {
	BackToList,
	focusNotes,
	IconButton,
	relative,
	useItemActions,
	useListInput,
} from "../reader";
import { KEYS } from "./shortcuts";

export function ItemDetail({
	itemId,
	hasPrev,
	hasNext,
	onPrev,
	onNext,
	onReadAndNext,
}: {
	itemId: string;
	hasPrev: boolean;
	hasNext: boolean;
	onPrev: () => void;
	onNext: () => void;
	onReadAndNext: () => void;
}) {
	const listInput = useListInput();
	const { data: item, isLoading } = api.reader.useItem(itemId);
	const actions = useItemActions(listInput);
	const [notesVisible, setNotesVisible] = useState(true);

	if (isLoading) {
		return (
			<div className="mx-auto max-w-[68ch] animate-pulse space-y-4 px-5 pt-14 md:px-8">
				<div className="h-7 w-4/5 rounded bg-accent" />
				<div className="h-4 w-2/5 rounded bg-accent/70" />
				<div className="space-y-3 pt-6">
					<div className="h-4 w-full rounded bg-accent/60" />
					<div className="h-4 w-full rounded bg-accent/60" />
					<div className="h-4 w-3/5 rounded bg-accent/60" />
				</div>
			</div>
		);
	}
	if (!item) {
		return (
			<div className="p-8 font-serif text-muted-foreground">
				{"Post not found."}
			</div>
		);
	}

	return (
		<div className="relative flex h-full flex-col">
			<div className="flex shrink-0 items-center justify-between border-b border-border/60 px-3 pb-1.5 pt-[max(0.375rem,env(safe-area-inset-top))] md:px-4">
				<BackToList />
				<div className="hidden md:block" />
				<div className="flex items-center gap-0.5">
					<IconButton
						label={item.starred ? "Unstar" : "Star"}
						kbd={KEYS.toggleStar}
						onClick={() => actions.toggleStar(item)}
					>
						<Star
							className={cn("h-4 w-4", item.starred && "fill-star text-star")}
						/>
					</IconButton>
					<IconButton
						label={item.readAt ? "Mark as unread" : "Mark as read"}
						kbd={KEYS.toggleRead}
						onClick={() => actions.toggleRead(item)}
					>
						{item.readAt ? (
							<Mail className="h-4 w-4" />
						) : (
							<MailOpen className="h-4 w-4" />
						)}
					</IconButton>
					{item.link && (
						<Tip label="Open in browser" kbd={KEYS.open}>
							<a
								href={item.link}
								target="_blank"
								rel="noreferrer"
								aria-label="Open in browser"
								className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								<ExternalLink className="h-4 w-4" />
							</a>
						</Tip>
					)}
				</div>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto pb-24 md:pb-[env(safe-area-inset-bottom)]">
				<header className="mx-auto max-w-[68ch] px-5 pt-8 md:px-8 md:pt-12">
					<h1 className="text-balance text-2xl font-semibold leading-tight tracking-tight md:text-[27px]">
						{item.link ? (
							<a
								href={item.link}
								target="_blank"
								rel="noreferrer"
								className="hover:underline hover:decoration-muted-foreground/50 hover:underline-offset-4"
							>
								{item.title}
							</a>
						) : (
							item.title
						)}
					</h1>
					<p
						className="mt-2.5 text-[13px] text-muted-foreground"
						title={item.publishedAt?.toLocaleString()}
					>
						{[
							item.feedTitle,
							item.author ?? undefined,
							relative(item.publishedAt),
						]
							.filter(Boolean)
							.join(" · ")}
					</p>
				</header>
				<Content html={item.contentHtml} text={item.contentText} />
				<NotesAndTags
					key={item.id}
					itemId={item.id}
					notes={item.notes ?? ""}
					tags={item.tags}
					update={actions.update}
					onVisibility={setNotesVisible}
				/>
			</div>
			{!notesVisible && (
				<Tip label="Write a note" kbd={KEYS.notes} side="left">
					<button
						type="button"
						onClick={focusNotes}
						className="absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] right-4 z-10 inline-flex items-center gap-1.5 rounded-full border bg-popover px-3 py-2 text-xs shadow-md hover:bg-accent md:bottom-6"
					>
						<PenLine className="h-3.5 w-3.5" />
						{"Add note"}
					</button>
				</Tip>
			)}
			<MobileBar
				hasPrev={hasPrev}
				hasNext={hasNext}
				onPrev={onPrev}
				onNext={onNext}
				onReadAndNext={onReadAndNext}
			/>
		</div>
	);
}

/** Thumb-reach triage on phones; the desktop relies on j / k / e. */
function MobileBar({
	hasPrev,
	hasNext,
	onPrev,
	onNext,
	onReadAndNext,
}: {
	hasPrev: boolean;
	hasNext: boolean;
	onPrev: () => void;
	onNext: () => void;
	onReadAndNext: () => void;
}) {
	const side =
		"inline-flex h-10 items-center gap-1 rounded-md border border-input px-3 text-sm hover:bg-accent disabled:opacity-40";
	return (
		<div className="absolute inset-x-0 bottom-0 z-10 flex items-center gap-2 border-t bg-card/95 px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
			<button
				type="button"
				onClick={onPrev}
				disabled={!hasPrev}
				className={side}
				aria-label="Previous post"
			>
				<ChevronLeft className="h-4 w-4" />
				{"Prev"}
			</button>
			<button
				type="button"
				onClick={onReadAndNext}
				className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90"
			>
				<CircleCheck className="h-4 w-4" />
				{"Mark read & next"}
			</button>
			<button
				type="button"
				onClick={onNext}
				disabled={!hasNext}
				className={side}
				aria-label="Next post"
			>
				{"Next"}
				<ChevronRight className="h-4 w-4" />
			</button>
		</div>
	);
}

/**
 * Feed HTML is untrusted. Links open in a new tab without a referrer or an
 * opener; images load lazily and never send a referrer either.
 */
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noopener noreferrer");
		node.setAttribute("referrerpolicy", "no-referrer");
	} else if (node.tagName === "IMG") {
		node.setAttribute("loading", "lazy");
		node.setAttribute("referrerpolicy", "no-referrer");
	}
});

const SANITIZE: Config = {
	FORBID_TAGS: [
		"form",
		"input",
		"button",
		"iframe",
		"object",
		"embed",
		"svg",
		"math",
		"style",
		"link",
		"meta",
		"base",
	],
	FORBID_ATTR: ["style", "srcdoc", "formaction", "ping"],
	ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i,
};

function Content({ html, text }: { html: string | null; text: string | null }) {
	// Without a DOM (SSR) DOMPurify returns the input untouched — never render that.
	const clean = useMemo(
		() =>
			html && DOMPurify.isSupported ? DOMPurify.sanitize(html, SANITIZE) : null,
		[html],
	);
	if (!clean && !text) {
		return (
			<p className="mx-auto max-w-[68ch] px-5 py-8 font-serif italic text-muted-foreground md:px-8">
				{"No content in feed."}
			</p>
		);
	}
	const column =
		"mx-auto max-w-[68ch] px-5 pb-4 pt-7 font-serif text-[17px] leading-[1.75] md:px-8";
	return clean ? (
		<article
			className={cn(
				column,
				"prose prose-neutral dark:prose-invert max-w-[68ch] break-words",
				"prose-headings:font-sans prose-headings:tracking-tight",
				"prose-a:text-primary prose-a:decoration-primary/40 prose-a:underline-offset-2",
				"prose-code:font-normal prose-pre:overflow-x-auto prose-pre:text-[13px]",
				"prose-img:max-w-full prose-img:rounded-md",
				"prose-blockquote:font-normal prose-blockquote:not-italic prose-blockquote:text-muted-foreground",
			)}
			// biome-ignore lint/security/noDangerouslySetInnerHtml: sanitized with DOMPurify above
			dangerouslySetInnerHTML={{ __html: clean }}
		/>
	) : (
		<p className={cn(column, "whitespace-pre-wrap")}>{text}</p>
	);
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

function NotesAndTags({
	itemId,
	notes,
	tags,
	update,
	onVisibility,
}: {
	itemId: string;
	notes: string;
	tags: string[];
	update: ReturnType<typeof useItemActions>["update"];
	onVisibility: (visible: boolean) => void;
}) {
	const [draft, setDraft] = useState(notes);
	const [chips, setChips] = useState(tags);
	const [status, setStatus] = useState<SaveStatus>("idle");
	const saved = useRef({ notes });
	const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const lastPayload = useRef<{ notes?: string; tags?: string[] } | null>(null);

	const save = (data: { notes?: string; tags?: string[] }) => {
		lastPayload.current = data;
		setStatus("saving");
		if (savedTimer.current) clearTimeout(savedTimer.current);
		update.mutate(
			{ itemId, ...data },
			{
				onSuccess: () => {
					setStatus("saved");
					savedTimer.current = setTimeout(() => setStatus("idle"), 2000);
				},
				onError: () => setStatus("error"),
			},
		);
	};

	// Debounced notes autosave, like the macOS app — scheduled from the
	// change handler (no useEffect); a pending save firing after unmount
	// is fine (it just persists the last draft).
	const onNotesChange = (value: string) => {
		setDraft(value);
		if (notesTimer.current) clearTimeout(notesTimer.current);
		notesTimer.current = setTimeout(() => {
			if (value === saved.current.notes) return;
			saved.current.notes = value;
			save({ notes: value });
		}, 800);
	};

	const setTags = (next: string[]) => {
		setChips(next);
		save({ tags: next });
	};

	const observe = (el: HTMLDivElement | null) => {
		if (!el) return;
		const io = new IntersectionObserver(([entry]) =>
			onVisibility(entry.isIntersecting),
		);
		io.observe(el);
		return () => io.disconnect();
	};

	return (
		<div
			ref={observe}
			className="mx-auto max-w-[68ch] space-y-2.5 border-t border-border/60 px-5 py-8 md:px-8"
		>
			<div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
				<CircleCheck className="h-3.5 w-3.5" />
				{"What did you learn?"}
				<span className="flex-1" />
				<SaveIndicator
					status={status}
					onRetry={() => lastPayload.current && save(lastPayload.current)}
				/>
			</div>
			<textarea
				value={draft}
				onChange={(e) => onNotesChange(e.target.value)}
				placeholder="Notes…"
				rows={4}
				data-notes
				className="w-full resize-y rounded-md border border-input bg-background/60 p-3 font-serif text-[15px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
				id={`notes-${itemId}`}
			/>
			<TagInput value={chips} onChange={setTags} />
		</div>
	);
}

function SaveIndicator({
	status,
	onRetry,
}: {
	status: SaveStatus;
	onRetry: () => void;
}) {
	if (status === "idle") return null;
	if (status === "error") {
		return (
			<span className="flex items-center gap-1 normal-case tracking-normal text-destructive">
				{"Couldn't save"}
				<span aria-hidden>{"·"}</span>
				<button
					type="button"
					onClick={onRetry}
					className="underline underline-offset-2"
				>
					{"Retry"}
				</button>
			</span>
		);
	}
	return (
		<span
			className={cn(
				"normal-case tracking-normal text-muted-foreground transition-opacity duration-500",
				status === "saved" && "text-primary",
			)}
		>
			{status === "saving" ? "Saving…" : "Saved"}
		</span>
	);
}

/** Chips with Enter / comma to add, Backspace to pop, and suggestions from the user's tags. */
function TagInput({
	value,
	onChange,
}: {
	value: string[];
	onChange: (tags: string[]) => void;
}) {
	const [input, setInput] = useState("");
	const [focused, setFocused] = useState(false);
	const { data: allTags = [] } = api.reader.useTags();
	const q = input.trim().toLowerCase();
	const suggestions = allTags
		.filter((t) => !value.includes(t) && (q === "" || t.includes(q)))
		.slice(0, 6);

	const add = (raw: string) => {
		const next = [
			...new Set([
				...value,
				...raw
					.split(",")
					.map((t) => t.trim().toLowerCase())
					.filter(Boolean),
			]),
		];
		setInput("");
		if (next.length !== value.length) onChange(next);
	};
	const remove = (tag: string) => onChange(value.filter((t) => t !== tag));

	return (
		<div className="relative">
			<div className="flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background/60 px-2 py-1.5 focus-within:ring-2 focus-within:ring-ring/40">
				{value.map((tag) => (
					<span
						key={tag}
						className="inline-flex items-center gap-1 rounded-md bg-accent px-2 py-0.5 text-xs"
					>
						{tag}
						<button
							type="button"
							aria-label={`Remove tag ${tag}`}
							onClick={() => remove(tag)}
							className="rounded text-muted-foreground hover:text-foreground"
						>
							<X className="h-3 w-3" />
						</button>
					</span>
				))}
				<input
					value={input}
					onChange={(e) => setInput(e.target.value)}
					onFocus={() => setFocused(true)}
					onBlur={() => {
						setFocused(false);
						if (input.trim()) add(input);
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === ",") {
							e.preventDefault();
							add(input);
						} else if (e.key === "Backspace" && input === "" && value.length) {
							remove(value[value.length - 1]);
						} else if (e.key === "Escape") {
							(e.target as HTMLInputElement).blur();
						}
					}}
					placeholder={value.length ? "Add tag" : "Tags"}
					aria-label="Tags"
					className="h-6 min-w-24 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground/70"
				/>
			</div>
			{focused && suggestions.length > 0 && (
				<ul className="absolute left-0 top-full z-10 mt-1 flex max-w-full flex-wrap gap-1 rounded-md border bg-popover p-1.5 shadow-md">
					{suggestions.map((t) => (
						<li key={t}>
							<button
								type="button"
								// Runs before the input's blur so the click isn't lost.
								onMouseDown={(e) => {
									e.preventDefault();
									add(t);
								}}
								className="rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
							>
								{t}
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}
