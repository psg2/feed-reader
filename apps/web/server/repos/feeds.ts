import type { db as DB } from "@feedreader/db/client";
import { feeds, items } from "@feedreader/db/schema";
import { and, asc, count, eq, sql } from "drizzle-orm";

type Db = typeof DB;

export async function listFeeds(db: Db, userId: string) {
	return db
		.select({
			feed: feeds,
			unread: count(sql`CASE WHEN ${items.readAt} IS NULL THEN 1 END`),
		})
		.from(feeds)
		.leftJoin(items, eq(items.feedId, feeds.id))
		.where(eq(feeds.userId, userId))
		.groupBy(feeds.id)
		.orderBy(feeds.title);
}

export async function getFeedByUrl(db: Db, userId: string, url: string) {
	const [feed] = await db
		.select()
		.from(feeds)
		.where(and(eq(feeds.userId, userId), eq(feeds.url, url)))
		.limit(1);
	return feed ?? null;
}

export async function createFeed(
	db: Db,
	data: {
		userId: string;
		title: string;
		url: string;
		siteUrl?: string | null;
		category?: string | null;
		fullPage?: boolean;
	},
) {
	const [feed] = await db
		.insert(feeds)
		.values(data)
		.onConflictDoNothing({ target: [feeds.userId, feeds.url] })
		.returning();
	return feed ?? null;
}

export async function updateFeed(
	db: Db,
	userId: string,
	feedId: string,
	data: Partial<{
		title: string;
		category: string | null;
		enabled: boolean;
		fullPage: boolean;
		lastFetchedAt: Date | null;
		lastError: string | null;
	}>,
) {
	const [feed] = await db
		.update(feeds)
		.set(data)
		.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)))
		.returning();
	return feed ?? null;
}

export async function deleteFeed(db: Db, userId: string, feedId: string) {
	await db
		.delete(feeds)
		.where(and(eq(feeds.id, feedId), eq(feeds.userId, userId)));
}

/** Enabled feeds across every user, stalest first — for the cron refresher. */
export async function listEnabledFeeds(db: Db) {
	return db
		.select()
		.from(feeds)
		.where(eq(feeds.enabled, true))
		.orderBy(sql`${feeds.lastFetchedAt} ASC NULLS FIRST`, asc(feeds.id));
}
