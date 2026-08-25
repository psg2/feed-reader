import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import Parser from "rss-parser";
import { env } from "@/lib/env";

export interface ParsedEntry {
	guid: string;
	link: string | null;
	title: string;
	author: string | null;
	publishedAt: Date | null;
	contentHtml: string | null;
	contentText: string | null;
}

export interface ParsedFeed {
	title: string;
	siteUrl: string | null;
	entries: ParsedEntry[];
}

const parser = new Parser({
	customFields: { item: [["content:encoded", "contentEncoded"]] },
});

/** Atom `<content type="html">` can surface as `{ _: "...", $: {...} }` instead of a string. */
function asString(v: unknown): string | null {
	if (typeof v === "string") return v;
	if (v && typeof v === "object" && "_" in v)
		return String((v as { _: unknown })._);
	return null;
}

const UA = "FeedReader/1.0 (+https://github.com/psg2/feed-reader)";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 15_000;

/** A feed that can't be reached, read or found — the user's URL, not our bug. */
export class FeedError extends Error {
	override readonly name = "FeedError";
}

/** Loopback, private, link-local, ULA, multicast, metadata and unspecified addresses. */
function isPrivateAddress(ip: string): boolean {
	const family = isIP(ip);
	if (family === 4) {
		const [a, b] = ip.split(".").map(Number);
		return (
			a === 0 || // "this" network
			a === 10 ||
			a === 127 ||
			(a === 100 && b >= 64 && b <= 127) || // CGNAT
			(a === 169 && b === 254) || // link-local + cloud metadata
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 192 && b === 0) || // 192.0.0.0/24 IETF, 192.0.2.0/24 TEST-NET
			(a === 198 && (b === 18 || b === 19)) || // benchmarking
			a >= 224 // multicast + reserved + broadcast
		);
	}
	if (family === 6) {
		const v = ip.toLowerCase();
		// IPv4-mapped / IPv4-compatible (::ffff:1.2.3.4, ::1.2.3.4)
		const mapped = /^(?:0*:)*(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/.exec(v);
		if (mapped) return isPrivateAddress(mapped[1]);
		if (v === "::" || v === "::1" || v.startsWith("64:ff9b:")) return true; // NAT64 may map to private v4
		const first = Number.parseInt(v.split(":")[0] || "0", 16);
		return (
			(first & 0xfe00) === 0xfc00 || // fc00::/7 unique local
			(first & 0xffc0) === 0xfe80 || // fe80::/10 link-local
			(first & 0xff00) === 0xff00 || // ff00::/8 multicast
			first === 0 // ::/8: unspecified, loopback, IPv4-mapped/compatible
		);
	}
	return true; // not an IP at all: refuse
}

/** Opt-in for local fixtures; never on the production deployment (the built server always runs with NODE_ENV=production, CI included). */
function privateHostsAllowed(): boolean {
	return (
		env.ALLOW_PRIVATE_FEED_HOSTS === "true" &&
		process.env.VERCEL_ENV !== "production"
	);
}

/**
 * Rejects URLs that would reach anything but a public http(s) host: loopback,
 * private, link-local and metadata ranges, checked on the literal host or on
 * every address the hostname resolves to.
 */
export async function assertPublicUrl(url: URL): Promise<void> {
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new FeedError(`Unsupported URL scheme: ${url.protocol}`);
	}
	if (url.username || url.password) {
		throw new FeedError("Credentials in feed URLs are not allowed");
	}
	if (privateHostsAllowed()) return;
	const host = url.hostname.replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost")) {
		throw new FeedError(`Refusing to fetch ${url}: local address`);
	}
	const addresses = isIP(host)
		? [host]
		: await lookup(host, { all: true, verbatim: true })
				.then((rs) => rs.map((r) => r.address))
				.catch(() => {
					throw new FeedError(`Couldn't resolve ${host}`);
				});
	if (addresses.length === 0) throw new FeedError(`Couldn't resolve ${host}`);
	if (addresses.some(isPrivateAddress)) {
		throw new FeedError(`Refusing to fetch ${url}: private address`);
	}
}

async function readCapped(res: Response, url: string): Promise<string> {
	const declared = Number(res.headers.get("content-length") ?? 0);
	if (declared > MAX_BODY_BYTES) {
		throw new FeedError(`Feed too large (over 5 MB): ${url}`);
	}
	if (!res.body) return "";
	const reader = res.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > MAX_BODY_BYTES) {
			await reader.cancel().catch(() => {});
			throw new FeedError(`Feed too large (over 5 MB): ${url}`);
		}
		chunks.push(value);
	}
	return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * fetch() for user-supplied URLs: http(s) only, public hosts only (each
 * redirect hop is re-checked, five at most), 15 s per hop and a 5 MB body cap.
 * Everything that goes wrong is a FeedError whose message is safe to show.
 */
export async function safeFetch(
	urlString: string,
	fetchImpl = fetch,
): Promise<{ url: string; text: string }> {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		throw new FeedError(`Invalid URL: ${urlString}`);
	}
	for (let hop = 0; ; hop += 1) {
		await assertPublicUrl(url);
		let res: Response;
		try {
			res = await fetchImpl(url.toString(), {
				headers: {
					"user-agent": UA,
					accept:
						"application/rss+xml, application/atom+xml, application/xml, text/xml, text/html, */*",
				},
				redirect: "manual",
				signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
			});
		} catch (err) {
			const timedOut = err instanceof Error && err.name === "TimeoutError";
			throw new FeedError(
				timedOut ? `Timed out fetching ${url}` : `Couldn't reach ${url}`,
			);
		}
		if (res.status >= 300 && res.status < 400) {
			const location = res.headers.get("location");
			await res.body?.cancel().catch(() => {});
			if (!location) throw new FeedError(`HTTP ${res.status} for ${url}`);
			if (hop >= MAX_REDIRECTS) {
				throw new FeedError(`Too many redirects for ${urlString}`);
			}
			try {
				url = new URL(location, url);
			} catch {
				throw new FeedError(`Invalid redirect from ${url}`);
			}
			continue;
		}
		if (!res.ok) {
			await res.body?.cancel().catch(() => {});
			throw new FeedError(`HTTP ${res.status} for ${url}`);
		}
		return { url: url.toString(), text: await readCapped(res, url.toString()) };
	}
}

export async function fetchText(
	url: string,
	fetchImpl = fetch,
): Promise<string> {
	return (await safeFetch(url, fetchImpl)).text;
}

export function stripHtml(html: string): string {
	return html
		.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&#39;|&apos;/g, "'")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

/** Invalid dates become null; dates more than a day ahead are clamped to now. */
function parseDate(raw: string | undefined): Date | null {
	if (!raw) return null;
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) return null;
	const limit = Date.now() + 24 * 60 * 60 * 1000;
	return d.getTime() > limit ? new Date() : d;
}

/** Entries without guid/id/link get a hash that survives re-fetches (a random id would duplicate them). */
function stableGuid(
	link: string | undefined,
	title: string | undefined,
	publishedAt: Date | null,
): string {
	return createHash("sha256")
		.update(
			`${link ?? ""}\n${title ?? ""}\n${publishedAt?.toISOString() ?? ""}`,
		)
		.digest("hex");
}

export function parseFeed(xml: string): Promise<ParsedFeed> {
	return parser
		.parseString(xml)
		.catch((err: unknown) => {
			const reason = err instanceof Error ? err.message : String(err);
			throw new FeedError(`Not a feed: ${reason}`);
		})
		.then((parsed) => ({
			title: parsed.title?.trim() || "Untitled feed",
			siteUrl: parsed.link ?? null,
			entries: (parsed.items ?? []).map((item) => {
				const raw = item as { contentEncoded?: unknown; summary?: unknown };
				const html =
					asString(raw.contentEncoded) ??
					asString(item.content) ??
					asString(raw.summary);
				const publishedAt = parseDate(item.isoDate ?? item.pubDate);
				return {
					guid:
						item.guid ??
						(item as { id?: string }).id ??
						item.link ??
						stableGuid(item.link, item.title, publishedAt),
					link: item.link ?? null,
					title: item.title?.trim() || "No title",
					author: item.creator ?? (item as { author?: string }).author ?? null,
					publishedAt,
					contentHtml: html,
					contentText: html
						? stripHtml(html)
						: (asString(item.contentSnippet) ?? null),
				};
			}),
		}));
}

function looksLikeFeed(text: string): boolean {
	const head = text.slice(0, 2048);
	return /<rss[\s>]|<feed[\s>]|<rdf:RDF/i.test(head);
}

/**
 * Resolves a URL to feed URLs: the URL itself when it already is a feed, otherwise
 * `<link rel="alternate" type="application/(rss|atom)+xml">` from the HTML, otherwise
 * the usual conventional paths. Mirrors the Swift `FeedDiscovery`.
 */
export async function discoverFeeds(
	urlString: string,
	fetchImpl = fetch,
): Promise<string[]> {
	let url: URL;
	try {
		url = new URL(urlString);
	} catch {
		throw new FeedError(`Invalid URL: ${urlString}`);
	}
	const body = await fetchText(url.toString(), fetchImpl);
	if (looksLikeFeed(body)) return [url.toString()];

	const links = [...body.matchAll(/<link\b[^>]*>/gi)]
		.map((m) => m[0])
		.filter(
			(tag) =>
				/rel=["']?alternate["']?/i.test(tag) &&
				/application\/(rss|atom)\+xml/i.test(tag),
		)
		.map((tag) => /href=["']([^"']+)["']/i.exec(tag)?.[1])
		.filter((href): href is string => Boolean(href))
		.map((href) => new URL(href, url).toString());
	if (links.length > 0) return [...new Set(links)];

	for (const path of [
		"/feed",
		"/feed.xml",
		"/rss.xml",
		"/atom.xml",
		"/index.xml",
		"/feed/rss.xml",
	]) {
		const candidate = new URL(path, url).toString();
		try {
			const text = await fetchText(candidate, fetchImpl);
			if (looksLikeFeed(text)) return [candidate];
		} catch {
			// try the next conventional path
		}
	}
	throw new FeedError(`No feed found at ${urlString}`);
}
