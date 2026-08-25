import type { db as DB } from "@feedreader/db/client";
import { users } from "@feedreader/db/schema";
import { asc } from "drizzle-orm";
import { stripHtml } from "@/server/lib/feedfetch";
import * as feedRepo from "@/server/repos/feeds";
import { storeEntries } from "@/server/repos/items";

type Db = typeof DB;

/** Shape of `GET https://api.resend.com/emails/receiving/{id}` (fields we use). */
export interface ReceivedEmail {
	id: string;
	from: string;
	to: string[];
	subject: string | null;
	html: string | null;
	text: string | null;
	headers?: Record<string, string>;
	message_id?: string | null;
	created_at: string;
	attachments?: ReceivedAttachment[];
}

/** Attachment metadata as embedded in the Received Email object. */
export interface ReceivedAttachment {
	id: string;
	filename: string;
	content_type: string;
	content_disposition: string | null;
	content_id: string | null;
	size: number;
}

/** Largest inline image we embed as a data: URI (Resend's free tier is small). */
export const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024;

const VIEW_IN_BROWSER_RE =
	/view (this|it|email|online|in( your)? browser)|read online|open in browser|ver no navegador|abrir no navegador/i;

export const NEWSLETTER_CATEGORY = "Newsletters";

/** Parses `Name <addr>` / `addr` into its parts. */
export function parseAddress(raw: string): {
	name: string | null;
	address: string;
} {
	const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
	if (m)
		return { name: m[1].trim() || null, address: m[2].trim().toLowerCase() };
	return { name: null, address: raw.trim().toLowerCase() };
}

/** Resend may deliver large bodies as a data: URI (`html_format: "data_uri"`). */
export function decodeBody(value: string | null): string | null {
	if (!value) return null;
	const m = value.match(/^data:[^,]*?(;base64)?,(.*)$/s);
	if (!m) return value;
	return m[1]
		? Buffer.from(m[2], "base64").toString("utf8")
		: decodeURIComponent(m[2]);
}

/**
 * Parses `INBOUND_ALLOWED_SENDERS`: comma-separated addresses (`a@b.com`) or
 * domains (`@b.com`), case-insensitive. Empty/undefined means "allow all".
 */
export function parseAllowedSenders(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
}

export function isSenderAllowed(address: string, allowed: string[]): boolean {
	if (allowed.length === 0) return true;
	const addr = address.toLowerCase();
	return allowed.some((rule) =>
		rule.startsWith("@") ? addr.endsWith(rule) : addr === rule,
	);
}

/**
 * Finds the newsletter's "view in browser" link by anchor text. Returns the
 * absolute http(s) href or null.
 */
export function findViewInBrowserLink(html: string): string | null {
	const re = /<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>(.*?)<\/a>/gis;
	for (const m of html.matchAll(re)) {
		const text = stripHtml(m[3]).replace(/\s+/g, " ").trim();
		const href = m[2].trim();
		if (VIEW_IN_BROWSER_RE.test(text) && /^https?:\/\//i.test(href))
			return href.replace(/&amp;/g, "&");
	}
	return null;
}

/** Shape of `GET …/receiving/{id}/attachments/{attachmentId}` (fields we use). */
interface AttachmentDownload {
	download_url: string;
	expires_at: string;
}

/** Downloads an attachment's bytes via its short-lived `download_url`. */
export async function fetchAttachment(
	apiKey: string,
	emailId: string,
	attachmentId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<Uint8Array> {
	const meta = await fetchImpl(
		`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(attachmentId)}`,
		{ headers: { authorization: `Bearer ${apiKey}` } },
	);
	if (!meta.ok)
		throw new Error(
			`Resend GET receiving/${emailId}/attachments/${attachmentId}: HTTP ${meta.status}`,
		);
	const { download_url } = (await meta.json()) as AttachmentDownload;
	const file = await fetchImpl(download_url);
	if (!file.ok)
		throw new Error(`Resend attachment ${attachmentId}: HTTP ${file.status}`);
	return new Uint8Array(await file.arrayBuffer());
}

function formatSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Inlines `cid:` images referenced by the HTML as data: URIs and appends a
 * list of the remaining attachments (name + size; download URLs expire, so no
 * links). Any download failure is logged and leaves the `cid:` untouched.
 */
export async function embedAttachments(
	html: string,
	email: Pick<ReceivedEmail, "id" | "attachments">,
	download: (attachmentId: string) => Promise<Uint8Array>,
): Promise<string> {
	const attachments = email.attachments ?? [];
	if (attachments.length === 0) return html;
	let out = html;
	const rest: ReceivedAttachment[] = [];
	for (const att of attachments) {
		const cid = att.content_id?.replace(/^<|>$/g, "");
		const inlineable =
			cid &&
			att.content_type.startsWith("image/") &&
			att.size <= MAX_INLINE_IMAGE_BYTES &&
			out.includes(`cid:${cid}`);
		if (!inlineable) {
			rest.push(att);
			continue;
		}
		try {
			const bytes = await download(att.id);
			const uri = `data:${att.content_type};base64,${Buffer.from(bytes).toString("base64")}`;
			out = out.replaceAll(`cid:${cid}`, uri);
		} catch (err) {
			console.warn("[inbound] attachment download failed", att.id, err);
			rest.push(att);
		}
	}
	if (rest.length > 0) {
		const items = rest
			.map(
				(a) =>
					`<li>${escapeHtml(a.filename)} <small>(${formatSize(a.size)})</small></li>`,
			)
			.join("");
		out += `<p class="attachments">Attachments</p><ul class="attachments">${items}</ul>`;
	}
	return out;
}

/**
 * Turns a received e-mail into an item of the feed `mailto:<sender>`, created
 * on first contact under the Newsletters category. Single-user instance: mail
 * is delivered to the first account. Idempotent on the message id.
 */
export async function ingestReceivedEmail(
	db: Db,
	email: ReceivedEmail,
	opts: {
		inboundDomain?: string;
		/** Parsed `INBOUND_ALLOWED_SENDERS`; empty = accept all. */
		allowedSenders?: string[];
		/** Downloads an attachment's bytes; omit to leave `cid:` references as is. */
		downloadAttachment?: (attachmentId: string) => Promise<Uint8Array>;
	} = {},
) {
	const from = parseAddress(email.headers?.from ?? email.from);
	if (!isSenderAllowed(from.address, opts.allowedSenders ?? []))
		return { status: "ignored" as const, reason: "sender" };
	if (opts.inboundDomain) {
		const domain = opts.inboundDomain.toLowerCase();
		const addressed = email.to.some((t) =>
			parseAddress(t).address.endsWith(`@${domain}`),
		);
		if (!addressed) return { status: "ignored" as const, reason: "recipient" };
	}
	const [owner] = await db
		.select({ id: users.id })
		.from(users)
		.orderBy(asc(users.createdAt))
		.limit(1);
	if (!owner) return { status: "ignored" as const, reason: "no-user" };

	const url = `mailto:${from.address}`;
	let feed = await feedRepo.getFeedByUrl(db, owner.id, url);
	if (!feed) {
		feed =
			(await feedRepo.createFeed(db, {
				userId: owner.id,
				title: from.name ?? from.address,
				url,
				category: NEWSLETTER_CATEGORY,
			})) ?? (await feedRepo.getFeedByUrl(db, owner.id, url));
	}
	if (!feed) throw new Error(`Newsletter feed for ${url} could not be created`);
	let html = decodeBody(email.html);
	const text = decodeBody(email.text);
	const link = html ? findViewInBrowserLink(html) : null;
	if (html && opts.downloadAttachment)
		html = await embedAttachments(html, email, opts.downloadAttachment);
	const inserted = await storeEntries(db, feed.id, [
		{
			guid: email.message_id?.trim() || `resend:${email.id}`,
			link,
			title: email.subject?.trim() || "(no subject)",
			author: from.name ?? from.address,
			publishedAt: new Date(email.created_at),
			contentHtml: html ?? (text ? `<pre>${escapeHtml(text)}</pre>` : null),
			contentText: text ?? (html ? stripHtml(html) : null),
		},
	]);
	await feedRepo.updateFeed(db, owner.id, feed.id, {
		lastFetchedAt: new Date(),
	});
	return {
		status: inserted ? ("stored" as const) : ("duplicate" as const),
		feedId: feed.id,
	};
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Fetches the full message; the webhook payload only carries metadata. */
export async function fetchReceivedEmail(
	apiKey: string,
	emailId: string,
	fetchImpl: typeof fetch = fetch,
): Promise<ReceivedEmail> {
	const res = await fetchImpl(
		`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}`,
		{ headers: { authorization: `Bearer ${apiKey}` } },
	);
	if (!res.ok)
		throw new Error(`Resend GET receiving/${emailId}: HTTP ${res.status}`);
	return (await res.json()) as ReceivedEmail;
}
