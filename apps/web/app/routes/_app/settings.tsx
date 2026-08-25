import type { AdminInvite, AdminUser, ConnectedApp } from "@feedreader/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
	Check,
	ChevronLeft,
	Copy,
	Download,
	Pause,
	Play,
	Trash2,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { getServerUserFn } from "@/app/server-fns/auth";
import { useSessionContext } from "@/components/providers/session-provider";
import { FeedIcon } from "@/components/shared/feed-icon";
import { InlineConfirm } from "@/components/ui/inline-confirm";
import { Tip } from "@/components/ui/tooltip";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth-client";
import { AddFeedForm, OpmlImportButton, relative } from "./reader";

export const Route = createFileRoute("/_app/settings")({
	component: SettingsPage,
	// The admin flag is decided server-side (ADMIN_EMAILS or first account).
	loader: () => getServerUserFn(),
});

function SettingsPage() {
	const me = Route.useLoaderData();
	const { data: inbound } = api.reader.useInboundAddress();
	return (
		<div className="min-h-dvh bg-background">
			<div className="mx-auto max-w-2xl px-5 pb-16 pt-[max(1.5rem,env(safe-area-inset-top))] md:pt-10">
				<Link
					to="/reader"
					className="-ml-1.5 inline-flex items-center gap-0.5 rounded-md py-1 pl-1 pr-2 text-sm text-muted-foreground hover:text-foreground"
				>
					<ChevronLeft className="h-4.5 w-4.5" />
					{"Reader"}
				</Link>
				<h1 className="mt-3 text-2xl font-semibold tracking-tight">
					{"Settings"}
				</h1>
				<FeedsSection />
				<NewslettersSection domain={inbound?.domain ?? null} />
				<AccountSection />
				{me?.isAdmin && <AdminSection />}
				<DevelopersSection />
			</div>
		</div>
	);
}

function SectionHeader({ title, sub }: { title: string; sub: string }) {
	return (
		<>
			<h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80">
				{title}
			</h2>
			<p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
				{sub}
			</p>
		</>
	);
}

const secondaryBtn =
	"inline-flex h-8 items-center gap-1.5 rounded-md border border-input px-3 text-xs hover:bg-accent disabled:opacity-50";
const iconBtn =
	"shrink-0 rounded-md p-2 text-muted-foreground/70 hover:bg-accent hover:text-foreground disabled:opacity-50";

function CopyButton({
	text,
	label = "Copy",
}: {
	text: string;
	label?: string;
}) {
	const [copied, setCopied] = useState(false);
	return (
		<button
			type="button"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(text);
				} catch {
					toast.error("Couldn't copy. Select the text and copy it instead.");
					return;
				}
				setCopied(true);
				setTimeout(() => setCopied(false), 2000);
			}}
			className={secondaryBtn}
		>
			{copied ? (
				<Check className="h-3.5 w-3.5 text-primary" />
			) : (
				<Copy className="h-3.5 w-3.5" />
			)}
			{copied ? "Copied" : label}
		</button>
	);
}

// ── Feeds ──────────────────────────────────────────────────────────────────

function FeedsSection() {
	const { data: feeds = [], isLoading } = api.reader.useFeeds();
	const remove = api.reader.useRemoveFeed({
		onSuccess: () => toast.success("Unsubscribed"),
	});
	const updateFeed = api.reader.useUpdateFeed({
		onError: (e) => toast.error(e.message),
	});

	return (
		<section className="mt-10">
			<SectionHeader
				title="Feeds"
				sub="Refreshed twice a day, 06:00 and 17:00 (São Paulo). Press r in the reader to refresh on demand. Paused feeds keep their posts but stop syncing."
			/>
			<div className="mt-4">
				<AddFeedForm />
			</div>
			<div className="mt-3 flex flex-wrap gap-2">
				<OpmlImportButton className={secondaryBtn} />
				<a href="/api/opml" download="feedreader.opml" className={secondaryBtn}>
					<Download className="h-3.5 w-3.5" />
					{"Export OPML"}
				</a>
			</div>
			<ul className="mt-2">
				{isLoading && (
					<li className="py-3 text-sm text-muted-foreground">{"Loading…"}</li>
				)}
				{!isLoading && feeds.length === 0 && (
					<li className="py-3 font-serif text-sm text-muted-foreground">
						{"No feeds yet. Add one above or import an OPML file."}
					</li>
				)}
				{feeds.map((f) => (
					<li
						key={f.id}
						className="flex items-center gap-3 border-b border-border/60 py-3"
					>
						<FeedIcon url={f.url} />
						<div className="min-w-0 flex-1">
							<div
								className={
									f.enabled
										? "truncate text-sm"
										: "truncate text-sm text-muted-foreground"
								}
							>
								{f.title}
							</div>
							<div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground/80">
								{!f.enabled ? (
									<span className="truncate">{"paused"}</span>
								) : f.lastError ? (
									<span
										className="flex min-w-0 items-center gap-1 text-star"
										title={f.lastError}
									>
										<TriangleAlert className="h-3 w-3 shrink-0" />
										<span className="truncate">{f.lastError}</span>
									</span>
								) : (
									<span className="truncate">
										{f.lastFetchedAt
											? `fetched ${relative(f.lastFetchedAt)} ago`
											: "never fetched"}
									</span>
								)}
							</div>
						</div>
						{f.unread > 0 && (
							<span className="shrink-0 text-xs tabular-nums text-muted-foreground">
								{f.unread}
							</span>
						)}
						<Tip label={f.enabled ? "Pause syncing" : "Resume syncing"}>
							<button
								type="button"
								aria-label={
									f.enabled ? `Pause ${f.title}` : `Resume ${f.title}`
								}
								disabled={updateFeed.isPending}
								onClick={() =>
									updateFeed.mutate({ feedId: f.id, enabled: !f.enabled })
								}
								className={iconBtn}
							>
								{f.enabled ? (
									<Pause className="h-4 w-4" />
								) : (
									<Play className="h-4 w-4" />
								)}
							</button>
						</Tip>
						<InlineConfirm
							question="Unsubscribe?"
							confirmLabel="Yes"
							disabled={remove.isPending}
							onConfirm={() => remove.mutate({ feedId: f.id })}
						>
							{(arm) => (
								<Tip label="Unsubscribe (deletes its posts and your notes on them)">
									<button
										type="button"
										aria-label={`Unsubscribe from ${f.title}`}
										disabled={remove.isPending}
										onClick={arm}
										className={`${iconBtn} hover:text-destructive`}
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</Tip>
							)}
						</InlineConfirm>
					</li>
				))}
			</ul>
		</section>
	);
}

// ── Newsletters ────────────────────────────────────────────────────────────

function NewslettersSection({ domain }: { domain: string | null }) {
	return (
		<section className="mt-12">
			<SectionHeader
				title="Newsletters"
				sub="Turn e-mail newsletters into feeds. Newsletter feeds get an envelope icon and their own sidebar section."
			/>
			<p className="mt-4 text-sm text-muted-foreground">
				Create an inbox at{" "}
				<a
					href="https://kill-the-newsletter.com"
					target="_blank"
					rel="noopener noreferrer"
					className="underline underline-offset-2"
				>
					kill-the-newsletter.com
				</a>
				, subscribe to the newsletter with the address it gives you, then add
				the inbox's feed URL here like any other feed.
			</p>
			{domain && (
				<>
					<p className="mt-4 text-sm text-muted-foreground">
						This instance also receives mail directly: anything sent to{" "}
						<code className="font-mono text-xs">{`anything@${domain}`}</code>{" "}
						becomes a feed named after the sender.
					</p>
					<div className="mt-2 flex items-center gap-2">
						<code className="min-w-0 flex-1 truncate rounded-md bg-accent/70 px-3 py-2 font-mono text-xs">
							{`news@${domain}`}
						</code>
						<CopyButton text={`news@${domain}`} />
					</div>
				</>
			)}
		</section>
	);
}

// ── Account ────────────────────────────────────────────────────────────────

function AccountSection() {
	const { session } = useSessionContext();
	const apps = api.reader.useConnectedApps();
	const revoke = api.reader.useRevokeApp({
		onSuccess: () => toast.success("Access revoked"),
		onError: (e) => toast.error(e.message),
	});
	return (
		<section className="mt-12">
			<SectionHeader
				title="Account"
				sub="Who you are here, and which apps you let in."
			/>
			{session?.user && (
				<dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
					<dt className="text-muted-foreground">{"Name"}</dt>
					<dd className="truncate">{session.user.name}</dd>
					<dt className="text-muted-foreground">{"Email"}</dt>
					<dd className="truncate">{session.user.email}</dd>
				</dl>
			)}
			<h3 className="mt-6 text-sm font-medium">{"Connected apps"}</h3>
			<ul className="mt-1">
				{apps.isError && (
					<li className="py-3 text-sm text-muted-foreground">
						{"Couldn't load connected apps. "}
						<button
							type="button"
							onClick={() => apps.refetch()}
							className="underline underline-offset-2 hover:text-foreground"
						>
							{"Try again"}
						</button>
					</li>
				)}
				{apps.data?.length === 0 && (
					<li className="py-3 font-serif text-sm text-muted-foreground">
						{
							"No apps connected. The macOS app and MCP clients show up here after you authorize them."
						}
					</li>
				)}
				{apps.data?.map((app) => (
					<ConnectedAppRow
						key={app.consentId}
						app={app}
						pending={revoke.isPending}
						onRevoke={() => revoke.mutate({ clientId: app.clientId })}
					/>
				))}
			</ul>
		</section>
	);
}

function ConnectedAppRow({
	app,
	pending,
	onRevoke,
}: {
	app: ConnectedApp;
	pending: boolean;
	onRevoke: () => void;
}) {
	return (
		<li className="flex items-center gap-3 border-b border-border/60 py-3">
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">
					{app.uri ? (
						<a
							href={app.uri}
							target="_blank"
							rel="noreferrer"
							className="hover:underline"
						>
							{app.name}
						</a>
					) : (
						app.name
					)}
				</div>
				<div className="mt-0.5 truncate text-xs text-muted-foreground/80">
					{app.scopes.join(", ")}
					{" · granted "}
					{app.grantedAt.toLocaleDateString()}
				</div>
			</div>
			<InlineConfirm
				question="Revoke access?"
				confirmLabel="Revoke"
				disabled={pending}
				onConfirm={onRevoke}
			>
				{(arm) => (
					<button
						type="button"
						onClick={arm}
						disabled={pending}
						className={secondaryBtn}
					>
						{"Revoke"}
					</button>
				)}
			</InlineConfirm>
		</li>
	);
}

// ── Admin ──────────────────────────────────────────────────────────────────

function AdminSection() {
	return (
		<section className="mt-12">
			<SectionHeader
				title="Admin"
				sub="Accounts on this instance. Registration is by invitation: send a link, and the invitee creates their account with that e-mail."
			/>
			<InviteForm />
			<InvitesList />
			<UsersList />
		</section>
	);
}

function InviteForm() {
	const [email, setEmail] = useState("");
	const [created, setCreated] = useState<{
		url: string;
		email: string;
		emailSent: boolean;
	} | null>(null);
	const create = api.admin.useCreateInvite({
		onSuccess: (invite) => {
			setCreated(invite);
			setEmail("");
		},
		onError: (e) => toast.error(e.message),
	});

	return (
		<>
			<h3 className="mt-5 text-sm font-medium">{"Invite by e-mail"}</h3>
			<form
				className="mt-2 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (email.trim()) create.mutate({ email: email.trim() });
				}}
			>
				<input
					type="email"
					value={email}
					onChange={(e) => setEmail(e.target.value)}
					placeholder="friend@example.com"
					aria-label="E-mail to invite"
					className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40"
				/>
				<button
					type="submit"
					disabled={create.isPending || !email.trim()}
					className="h-9 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{create.isPending ? "Inviting…" : "Invite"}
				</button>
			</form>
			{created && (
				<div className="mt-4 rounded-lg border border-star/40 bg-star/10 p-4">
					<p className="text-sm font-medium">
						{created.emailSent
							? `Invitation e-mailed to ${created.email}. The link below works too; it isn't shown again.`
							: `E-mail isn't configured on this instance: copy this link and send it to ${created.email}. It isn't shown again.`}
					</p>
					<div className="mt-2 flex items-center gap-2">
						<code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
							{created.url}
						</code>
						<CopyButton text={created.url} label="Copy link" />
					</div>
					<button
						type="button"
						onClick={() => setCreated(null)}
						className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
					>
						{"Done, dismiss"}
					</button>
				</div>
			)}
		</>
	);
}

function InvitesList() {
	const invites = api.admin.useInvites();
	const revoke = api.admin.useRevokeInvite({
		onSuccess: () => toast.success("Invitation revoked"),
		onError: (e) => toast.error(e.message),
	});
	const open = invites.data?.filter((i) => i.status !== "accepted") ?? [];
	if (invites.data && open.length === 0) return null;
	return (
		<>
			<h3 className="mt-6 text-sm font-medium">{"Pending invitations"}</h3>
			<ul className="mt-1">
				{open.map((invite) => (
					<InviteRow
						key={invite.id}
						invite={invite}
						pending={revoke.isPending}
						onRevoke={() => revoke.mutate({ id: invite.id })}
					/>
				))}
			</ul>
		</>
	);
}

function InviteRow({
	invite,
	pending,
	onRevoke,
}: {
	invite: AdminInvite;
	pending: boolean;
	onRevoke: () => void;
}) {
	return (
		<li className="flex items-center gap-3 border-b border-border/60 py-3">
			<div className="min-w-0 flex-1">
				<div className="truncate text-sm">{invite.email}</div>
				<div className="mt-0.5 text-xs text-muted-foreground/80">
					{invite.status === "expired"
						? `expired ${invite.expiresAt.toLocaleDateString()}`
						: `expires ${invite.expiresAt.toLocaleDateString()}`}
				</div>
			</div>
			<span
				className={
					invite.status === "expired"
						? "shrink-0 text-xs text-star"
						: "shrink-0 text-xs text-muted-foreground"
				}
			>
				{invite.status}
			</span>
			<InlineConfirm
				question="Revoke invitation?"
				confirmLabel="Revoke"
				disabled={pending}
				onConfirm={onRevoke}
			>
				{(arm) => (
					<button
						type="button"
						onClick={arm}
						disabled={pending}
						className={secondaryBtn}
					>
						{"Revoke"}
					</button>
				)}
			</InlineConfirm>
		</li>
	);
}

function UsersList() {
	const { session } = useSessionContext();
	const users = api.admin.useUsers();
	const remove = api.admin.useDeleteUser({
		onSuccess: () => toast.success("Account removed"),
		onError: (e) => toast.error(e.message),
	});
	return (
		<>
			<h3 className="mt-6 text-sm font-medium">{"Users"}</h3>
			<ul className="mt-1">
				{users.isError && (
					<li className="py-3 text-sm text-muted-foreground">
						{"Couldn't load users. "}
						<button
							type="button"
							onClick={() => users.refetch()}
							className="underline underline-offset-2 hover:text-foreground"
						>
							{"Try again"}
						</button>
					</li>
				)}
				{users.data?.map((u) => (
					<UserRow
						key={u.id}
						user={u}
						isSelf={u.id === session?.user.id}
						pending={remove.isPending}
						onRemove={() => remove.mutate({ id: u.id })}
					/>
				))}
			</ul>
		</>
	);
}

function UserRow({
	user,
	isSelf,
	pending,
	onRemove,
}: {
	user: AdminUser;
	isSelf: boolean;
	pending: boolean;
	onRemove: () => void;
}) {
	return (
		<li className="flex items-center gap-3 border-b border-border/60 py-3">
			<div className="min-w-0 flex-1">
				<div className="flex items-center gap-2 text-sm">
					<span className="truncate">{user.name || user.email}</span>
					{user.isAdmin && (
						<span className="shrink-0 rounded-full border border-primary/40 px-1.5 py-px text-[10px] font-medium uppercase tracking-wider text-primary">
							{"admin"}
						</span>
					)}
					{isSelf && (
						<span className="shrink-0 text-xs text-muted-foreground">
							{"(you)"}
						</span>
					)}
				</div>
				<div className="mt-0.5 truncate text-xs text-muted-foreground/80">
					{user.email}
					{" · joined "}
					{user.createdAt.toLocaleDateString()}
				</div>
			</div>
			{!isSelf && (
				<InlineConfirm
					question="Remove account and all its data?"
					confirmLabel="Remove"
					disabled={pending}
					onConfirm={onRemove}
				>
					{(arm) => (
						<Tip label="Remove account (deletes its feeds, notes and keys)">
							<button
								type="button"
								aria-label={`Remove ${user.email}`}
								onClick={arm}
								disabled={pending}
								className={`${iconBtn} hover:text-destructive`}
							>
								<Trash2 className="h-4 w-4" />
							</button>
						</Tip>
					)}
				</InlineConfirm>
			)}
		</li>
	);
}

// ── Developers ─────────────────────────────────────────────────────────────

const KEYS_QUERY = ["auth", "api-keys"];

function DevelopersSection() {
	const qc = useQueryClient();
	const [name, setName] = useState("");
	const [createdKey, setCreatedKey] = useState<string | null>(null);
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	const mcpCommand = `claude mcp add --transport http --scope user feedreader ${origin}/api/mcp`;

	const keys = useQuery({
		queryKey: KEYS_QUERY,
		queryFn: async () => {
			const { data, error } = await authClient.apiKey.list();
			if (error) throw new Error(error.message);
			return data?.apiKeys ?? [];
		},
	});

	const create = useMutation({
		mutationFn: async (keyName: string) => {
			const { data, error } = await authClient.apiKey.create({
				name: keyName,
			});
			if (error) throw new Error(error.message);
			return data;
		},
		onSuccess: (data) => {
			setCreatedKey(data?.key ?? null);
			setName("");
			qc.invalidateQueries({ queryKey: KEYS_QUERY });
		},
	});

	const revoke = useMutation({
		mutationFn: async (keyId: string) => {
			const { error } = await authClient.apiKey.delete({ keyId });
			if (error) throw new Error(error.message);
		},
		onSuccess: () => qc.invalidateQueries({ queryKey: KEYS_QUERY }),
	});

	return (
		<section className="mt-12">
			<SectionHeader
				title="Developers"
				sub="Scripts and tools use a key as a Bearer token. The macOS app and MCP clients sign in with your account and don't need one."
			/>

			<h3 className="mt-5 text-sm font-medium">{"Claude Code"}</h3>
			<div className="mt-1.5 flex items-center gap-2">
				<code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-md bg-accent/70 px-3 py-2 font-mono text-xs">
					{mcpCommand}
				</code>
				<CopyButton text={mcpCommand} />
			</div>

			<div className="mt-6 flex items-center justify-between gap-3">
				<h3 className="text-sm font-medium">{"API keys"}</h3>
				<a
					href="/api/reference"
					target="_blank"
					rel="noreferrer"
					className={secondaryBtn}
				>
					{"API reference"}
				</a>
			</div>
			<form
				className="mt-2 flex gap-2"
				onSubmit={(e) => {
					e.preventDefault();
					if (name.trim()) create.mutate(name.trim());
				}}
			>
				<input
					value={name}
					onChange={(e) => setName(e.target.value)}
					placeholder="Key name (e.g. scripts)"
					className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring/40"
				/>
				<button
					type="submit"
					disabled={create.isPending || !name.trim()}
					className="h-9 shrink-0 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
				>
					{create.isPending ? "Creating…" : "Create"}
				</button>
			</form>
			{create.isError && (
				<p className="mt-2 text-sm text-destructive">
					{(create.error as Error).message}
				</p>
			)}

			{createdKey && (
				<NewKeyReveal
					keyValue={createdKey}
					onDone={() => setCreatedKey(null)}
				/>
			)}

			<ul className="mt-2">
				{keys.data?.length === 0 && (
					<li className="py-3 font-serif text-sm text-muted-foreground">
						{"No keys yet."}
					</li>
				)}
				{keys.data?.map((k) => (
					<li
						key={k.id}
						className="flex items-center gap-3 border-b border-border/60 py-3"
					>
						<div className="min-w-0 flex-1">
							<div className="truncate text-sm">{k.name ?? "unnamed"}</div>
							<div className="mt-0.5 text-xs text-muted-foreground/80">
								<code className="font-mono">{k.start ?? "app_"}…</code>
								{" · created "}
								{new Date(k.createdAt).toLocaleDateString()}
							</div>
						</div>
						<InlineConfirm
							question="Revoke key?"
							confirmLabel="Revoke"
							disabled={revoke.isPending}
							onConfirm={() => revoke.mutate(k.id)}
						>
							{(arm) => (
								<Tip label="Revoke">
									<button
										type="button"
										aria-label={`Revoke ${k.name ?? "key"}`}
										onClick={arm}
										disabled={revoke.isPending}
										className={`${iconBtn} hover:text-destructive`}
									>
										<Trash2 className="h-4 w-4" />
									</button>
								</Tip>
							)}
						</InlineConfirm>
					</li>
				))}
			</ul>
		</section>
	);
}

function NewKeyReveal({
	keyValue,
	onDone,
}: {
	keyValue: string;
	onDone: () => void;
}) {
	return (
		<div className="mt-4 rounded-lg border border-star/40 bg-star/10 p-4">
			<p className="text-sm font-medium">
				{"Copy this key now: it won't be shown again."}
			</p>
			<div className="mt-2 flex items-center gap-2">
				<code className="min-w-0 flex-1 truncate rounded bg-background px-2 py-1.5 font-mono text-xs">
					{keyValue}
				</code>
				<CopyButton text={keyValue} />
			</div>
			<button
				type="button"
				onClick={onDone}
				className="mt-3 text-xs text-muted-foreground underline hover:text-foreground"
			>
				{"Saved it, dismiss"}
			</button>
		</div>
	);
}
