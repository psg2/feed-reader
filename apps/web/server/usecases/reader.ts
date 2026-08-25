import type { db as DB } from "@feedreader/db/client";
import * as feedRepo from "@/server/repos/feeds";
import * as itemRepo from "@/server/repos/items";
import * as oauthRepo from "@/server/repos/oauth";
import { env } from "@/lib/env";
import {
	discoverFeeds,
	FeedError,
	fetchText,
	parseFeed,
} from "@/server/lib/feedfetch";
import { buildOpml, parseOpml } from "@/server/lib/opml";

type Db = typeof DB;
type ItemRow = Awaited<ReturnType<typeof itemRepo.listItems>>[number];

function toItem(row: ItemRow) {
	const { contentHtml: _h, contentText: _t, ...item } = row.item;
	return { ...item, feedTitle: row.feedTitle };
}

type FeedRow = Awaited<ReturnType<typeof feedRepo.listFeeds>>[number];

function toFeed(row: FeedRow) {
	const { userId: _u, createdAt: _c, updatedAt: _up, ...feed } = row.feed;
	return { ...feed, unread: row.unread };
}

export async function listItems(
	db: Db,
	userId: string,
	input: { filter: itemRepo.ItemFilter; search: string; limit: number },
) {
	const rows = await itemRepo.listItems(
		db,
		userId,
		input.filter,
		input.search,
		input.limit,
	);
	return rows.map(toItem);
}

export async function getItem(db: Db, userId: string, itemId: string) {
	const row = await itemRepo.getItem(db, userId, itemId);
	if (!row) return null;
	const { userId: _u, ...rest } = { ...row.item, userId: "" };
	return {
		...rest,
		feedTitle: row.feedTitle,
		feedFullPage: row.feedFullPage,
		tags: row.tags,
	};
}

export async function updateItem(
	db: Db,
	userId: string,
	itemId: string,
	data: { read?: boolean; starred?: boolean; notes?: string; tags?: string[] },
) {
	if (data.read !== undefined)
		await itemRepo.markRead(db, userId, [itemId], data.read);
	if (data.starred !== undefined)
		await itemRepo.setStarred(db, userId, itemId, data.starred);
	if (data.notes !== undefined)
		await itemRepo.setNotes(db, userId, itemId, data.notes);
	if (data.tags !== undefined)
		await itemRepo.setTags(db, userId, itemId, data.tags);
	const row = await itemRepo.getItem(db, userId, itemId);
	return row ? toItem(row) : null;
}

export async function markRead(
	db: Db,
	userId: string,
	itemIds: string[],
	read: boolean,
) {
	return itemRepo.markRead(db, userId, itemIds, read);
}

export async function markAllRead(
	db: Db,
	userId: string,
	input: { feedId?: string; filter?: itemRepo.ItemFilter } = {},
) {
	const filter: itemRepo.ItemFilter =
		input.filter ??
		(input.feedId ? { kind: "feed", feedId: input.feedId } : { kind: "all" });
	return itemRepo.markAllRead(db, userId, filter);
}

export async function listFeeds(db: Db, userId: string) {
	return (await feedRepo.listFeeds(db, userId)).map(toFeed);
}

export async function listTags(db: Db, userId: string) {
	return itemRepo.listAllTags(db, userId);
}

export async function updateFeed(
	db: Db,
	userId: string,
	feedId: string,
	data: {
		title?: string;
		category?: string | null;
		enabled?: boolean;
		fullPage?: boolean;
	},
) {
	const feed = await feedRepo.updateFeed(db, userId, feedId, data);
	if (!feed) return null;
	const all = await feedRepo.listFeeds(db, userId);
	return all.filter((r) => r.feed.id === feedId).map(toFeed)[0] ?? null;
}

export async function removeFeed(db: Db, userId: string, feedId: string) {
	await feedRepo.deleteFeed(db, userId, feedId);
}

/** Subscribe with autodiscovery; the newest `keepUnread` arrive unread. Mirrors Swift `FeedFetcher.subscribe`. */
export async function subscribe(
	db: Db,
	userId: string,
	input: { url: string; category?: string },
	fetchImpl = fetch,
) {
	const [feedUrl] = await discoverFeeds(input.url, fetchImpl);
	const parsed = await parseFeed(await fetchText(feedUrl, fetchImpl));
	const feed = await feedRepo.createFeed(db, {
		userId,
		title: parsed.title,
		url: feedUrl,
		siteUrl: parsed.siteUrl,
		category: input.category ?? null,
	});
	if (!feed) throw new Error(`Already exists: subscribed to ${feedUrl}`);
	await itemRepo.storeEntries(db, feed.id, parsed.entries, {
		markExistingAsRead: true,
		keepUnread: 5,
	});
	await feedRepo.updateFeed(db, userId, feed.id, {
		lastFetchedAt: new Date(),
		lastError: null,
	});
	const all = await feedRepo.listFeeds(db, userId);
	return all.filter((r) => r.feed.id === feed.id).map(toFeed)[0]!;
}

/** Manual refreshes closer together than this are a no-op — feeds don't change that fast. */
const REFRESH_COOLDOWN_MS = 60_000;
/** Cron skips feeds fetched more recently than this unless forced. */
const REFRESH_STALE_MS = 10 * 60_000;
const REFRESH_CONCURRENCY = 6;

/**
 * Refreshes the user's enabled feeds. Used by the API; the cron variant
 * sweeps all users. Returns an empty summary when everything was fetched
 * less than a minute ago.
 */
export async function refresh(db: Db, userId: string, fetchImpl = fetch) {
	const feeds = (await feedRepo.listFeeds(db, userId))
		.map((r) => r.feed)
		.filter((f) => f.enabled);
	const newest = Math.max(...feeds.map((f) => f.lastFetchedAt?.getTime() ?? 0));
	if (feeds.length > 0 && Date.now() - newest < REFRESH_COOLDOWN_MS) {
		return { feedsChecked: 0, feedsFailed: 0, newItems: 0 };
	}
	return refreshFeeds(db, feeds, fetchImpl, { force: true });
}

/** Runs `fn` over `inputs`, at most `limit` at a time, in input order. */
async function mapPool<T, R>(
	inputs: T[],
	limit: number,
	fn: (input: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
	const results: PromiseSettledResult<R>[] = new Array(inputs.length);
	let next = 0;
	const worker = async () => {
		while (next < inputs.length) {
			const i = next++;
			try {
				results[i] = { status: "fulfilled", value: await fn(inputs[i]) };
			} catch (reason) {
				results[i] = { status: "rejected", reason };
			}
		}
	};
	await Promise.all(
		Array.from({ length: Math.min(limit, inputs.length) }, worker),
	);
	return results;
}

/** Only FeedError messages are meant for users; anything else is our bug and stays in the logs. */
function publicMessage(err: unknown): string {
	if (err instanceof FeedError) return err.message;
	console.error("[feeds]", err);
	return "Unexpected error while fetching";
}

export async function refreshFeeds(
	db: Db,
	feeds: Array<{
		id: string;
		userId: string;
		url: string;
		lastFetchedAt?: Date | null;
	}>,
	fetchImpl = fetch,
	opts: { force?: boolean } = {},
) {
	const summary = { feedsChecked: 0, feedsFailed: 0, newItems: 0 };
	const staleBefore = Date.now() - REFRESH_STALE_MS;
	// Newsletters (`mailto:` feeds) are filled by the inbound webhook, never fetched.
	feeds = feeds.filter(
		(feed) =>
			!feed.url.startsWith("mailto:") &&
			(opts.force || (feed.lastFetchedAt?.getTime() ?? 0) < staleBefore),
	);
	const results = await mapPool(feeds, REFRESH_CONCURRENCY, async (feed) => {
		const parsed = await parseFeed(await fetchText(feed.url, fetchImpl));
		const added = await itemRepo.storeEntries(db, feed.id, parsed.entries, {
			markExistingAsRead: false,
		});
		await feedRepo.updateFeed(db, feed.userId, feed.id, {
			lastFetchedAt: new Date(),
			lastError: null,
		});
		return added;
	});
	for (const [i, r] of results.entries()) {
		summary.feedsChecked += 1;
		if (r.status === "fulfilled") {
			summary.newItems += r.value;
		} else {
			summary.feedsFailed += 1;
			await feedRepo.updateFeed(db, feeds[i].userId, feeds[i].id, {
				lastError: publicMessage(r.reason),
			});
		}
	}
	return summary;
}

/** Cron entrypoint: every enabled feed of every user, skipping those fetched in the last 10 minutes. */
export async function refreshAllUsers(
	db: Db,
	fetchImpl = fetch,
	opts: { force?: boolean } = {},
) {
	return refreshFeeds(db, await feedRepo.listEnabledFeeds(db), fetchImpl, opts);
}

/** Where newsletters land; null when inbound mail isn't configured. */
export function inboundAddress() {
	return { domain: env.INBOUND_EMAIL_DOMAIN ?? null };
}

export async function connectedApps(db: Db, userId: string) {
	return (await oauthRepo.listConsents(db, userId)).map((c) => ({
		consentId: c.consentId,
		clientId: c.clientId,
		name: c.name ?? c.clientId,
		icon: c.icon ?? null,
		uri: c.uri ?? null,
		scopes: c.scopes,
		grantedAt: c.grantedAt,
	}));
}

export async function revokeApp(db: Db, userId: string, clientId: string) {
	await oauthRepo.revokeClient(db, userId, clientId);
}

/** More outlines than this and the import is refused rather than fetched for minutes. */
const OPML_MAX_OUTLINES = 500;
const OPML_CONCURRENCY = 4;

/**
 * Subscribes to every `xmlUrl` in an OPML file, four at a time.
 * Already-subscribed URLs are skipped; anything that fails to fetch lands in
 * `failed` without aborting the rest.
 */
export async function importOpml(
	db: Db,
	userId: string,
	xml: string,
	fetchImpl = fetch,
) {
	const outlines = parseOpml(xml);
	if (outlines.length > OPML_MAX_OUTLINES) {
		throw new FeedError(
			`OPML has ${outlines.length} feeds; the limit is ${OPML_MAX_OUTLINES}`,
		);
	}
	const existing = new Set(
		(await feedRepo.listFeeds(db, userId)).map((r) => r.feed.url),
	);
	const result = {
		added: 0,
		skipped: 0,
		failed: [] as Array<{ url: string; error: string }>,
	};
	const todo = outlines.filter((o) => {
		if (existing.has(o.xmlUrl)) {
			result.skipped += 1;
			return false;
		}
		existing.add(o.xmlUrl);
		return true;
	});
	await mapPool(todo, OPML_CONCURRENCY, async (o) => {
		try {
			await subscribe(
				db,
				userId,
				{ url: o.xmlUrl, category: o.category ?? undefined },
				fetchImpl,
			);
			result.added += 1;
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.startsWith("Already exists")) result.skipped += 1;
			else result.failed.push({ url: o.xmlUrl, error: publicMessage(err) });
		}
	});
	return result;
}

export async function exportOpml(db: Db, userId: string) {
	const feeds = (await feedRepo.listFeeds(db, userId)).map((r) => r.feed);
	return buildOpml(feeds);
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

/** Full mirror dump for native clients — dates as ISO strings. */
export async function syncDump(db: Db, userId: string) {
	const [feedRows, itemRows] = await Promise.all([
		feedRepo.listFeeds(db, userId),
		itemRepo.listItemsForSync(db, userId),
	]);
	return {
		feeds: feedRows.map(({ feed }) => ({
			id: feed.id,
			title: feed.title,
			url: feed.url,
			siteUrl: feed.siteUrl,
			category: feed.category,
			enabled: feed.enabled,
			fullPage: feed.fullPage,
			lastFetchedAt: iso(feed.lastFetchedAt),
			lastError: feed.lastError,
		})),
		items: itemRows.map(({ item, tags }) => ({
			id: item.id,
			feedId: item.feedId,
			guid: item.guid,
			link: item.link,
			title: item.title,
			author: item.author,
			publishedAt: iso(item.publishedAt),
			contentHtml: item.contentHtml,
			contentText: item.contentText,
			readAt: iso(item.readAt),
			starred: item.starred,
			notes: item.notes,
			tags,
		})),
	};
}
