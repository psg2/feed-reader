import type { db as DB } from "@feedreader/db/client";
import { feeds, itemTags, items } from "@feedreader/db/schema";
import {
	and,
	desc,
	eq,
	exists,
	ilike,
	inArray,
	isNull,
	or,
	sql,
} from "drizzle-orm";

type Db = typeof DB;

export type ItemFilter =
	| { kind: "unread" }
	| { kind: "all" }
	| { kind: "starred" }
	| { kind: "feed"; feedId: string }
	| { kind: "tag"; tag: string };

/**
 * Items joined with their feed title, newest first — same semantics as the
 * macOS `AppDatabase.itemsRequest`. Always scoped to the user via the feed.
 */
function viewCondition(db: Db, filter: ItemFilter) {
	switch (filter.kind) {
		case "unread":
			return isNull(items.readAt);
		case "starred":
			return eq(items.starred, true);
		case "feed":
			return eq(items.feedId, filter.feedId);
		case "tag":
			return exists(
				db
					.select({ one: sql`1` })
					.from(itemTags)
					.where(
						and(eq(itemTags.itemId, items.id), eq(itemTags.tag, filter.tag)),
					),
			);
		case "all":
			return undefined;
	}
}

/** `%`, `_` and `\\` are ILIKE metacharacters; the user typed them literally. */
function escapeLike(q: string): string {
	return q.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listItems(
	db: Db,
	userId: string,
	filter: ItemFilter,
	search = "",
	limit = 50,
) {
	const conditions = [eq(feeds.userId, userId), viewCondition(db, filter)];
	const q = search.trim();
	if (q !== "") {
		const like = `%${escapeLike(q)}%`;
		conditions.push(
			or(
				ilike(items.title, like),
				ilike(items.contentText, like),
				ilike(items.notes, like),
			)!,
		);
	}
	return db
		.select({ item: items, feedTitle: feeds.title })
		.from(items)
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(and(...conditions))
		.orderBy(desc(items.publishedAt), desc(items.createdAt))
		.limit(Math.max(1, Math.min(limit, 500)));
}

export async function getItem(db: Db, userId: string, itemId: string) {
	const [row] = await db
		.select({
			item: items,
			feedTitle: feeds.title,
			feedFullPage: feeds.fullPage,
		})
		.from(items)
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(and(eq(items.id, itemId), eq(feeds.userId, userId)))
		.limit(1);
	if (!row) return null;
	const tags = await listTagsForItem(db, itemId);
	return { ...row, tags };
}

/** Ownership guard used by every write. */
async function ownedItemIds(db: Db, userId: string, itemIds: string[]) {
	const rows = await db
		.select({ id: items.id })
		.from(items)
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(and(inArray(items.id, itemIds), eq(feeds.userId, userId)));
	return rows.map((r) => r.id);
}

export async function markRead(
	db: Db,
	userId: string,
	itemIds: string[],
	read: boolean,
) {
	const owned = await ownedItemIds(db, userId, itemIds);
	if (owned.length === 0) return [];
	await db
		.update(items)
		.set({ readAt: read ? new Date() : null })
		.where(inArray(items.id, owned));
	return owned;
}

/** Marks every unread item in a view read; returns the ids for undo. */
export async function markAllRead(
	db: Db,
	userId: string,
	filter: ItemFilter = { kind: "all" },
) {
	const rows = await db
		.select({ id: items.id })
		.from(items)
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(
			and(
				eq(feeds.userId, userId),
				isNull(items.readAt),
				viewCondition(db, filter),
			),
		);
	const ids = rows.map((r) => r.id);
	if (ids.length > 0) {
		await db
			.update(items)
			.set({ readAt: new Date() })
			.where(inArray(items.id, ids));
	}
	return ids;
}

export async function setStarred(
	db: Db,
	userId: string,
	itemId: string,
	starred: boolean,
) {
	const owned = await ownedItemIds(db, userId, [itemId]);
	if (owned.length === 0) return null;
	const [row] = await db
		.update(items)
		.set({ starred })
		.where(eq(items.id, itemId))
		.returning();
	return row;
}

export async function setNotes(
	db: Db,
	userId: string,
	itemId: string,
	notes: string,
) {
	const owned = await ownedItemIds(db, userId, [itemId]);
	if (owned.length === 0) return null;
	const [row] = await db
		.update(items)
		.set({ notes })
		.where(eq(items.id, itemId))
		.returning();
	return row;
}

export async function listTagsForItem(db: Db, itemId: string) {
	const rows = await db
		.select({ tag: itemTags.tag })
		.from(itemTags)
		.where(eq(itemTags.itemId, itemId))
		.orderBy(itemTags.tag);
	return rows.map((r) => r.tag);
}

export async function setTags(
	db: Db,
	userId: string,
	itemId: string,
	tags: string[],
) {
	const owned = await ownedItemIds(db, userId, [itemId]);
	if (owned.length === 0) return null;
	const clean = [
		...new Set(tags.map((t) => t.trim().toLowerCase()).filter((t) => t !== "")),
	];
	// One statement, so a crash or a concurrent save never leaves the item
	// with no tags: add what's missing, drop what's gone.
	await db.execute(sql`
		WITH keep AS (SELECT jsonb_array_elements_text(${JSON.stringify(clean)}::jsonb) AS tag),
		ins AS (
			INSERT INTO ${itemTags} (item_id, tag)
			SELECT ${itemId}, tag FROM keep
			ON CONFLICT DO NOTHING
		)
		DELETE FROM ${itemTags}
		WHERE ${itemTags.itemId} = ${itemId} AND tag NOT IN (SELECT tag FROM keep)
	`);
	return clean.sort();
}

export async function listAllTags(db: Db, userId: string) {
	const rows = await db
		.selectDistinct({ tag: itemTags.tag })
		.from(itemTags)
		.innerJoin(items, eq(itemTags.itemId, items.id))
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(eq(feeds.userId, userId))
		.orderBy(itemTags.tag);
	return rows.map((r) => r.tag);
}

/** Upserts fetched entries; returns how many were new. Mirrors the Swift `FeedFetcher.store`. */
export async function storeEntries(
	db: Db,
	feedId: string,
	entries: Array<{
		guid: string;
		link?: string | null;
		title: string;
		author?: string | null;
		publishedAt?: Date | null;
		contentHtml?: string | null;
		contentText?: string | null;
	}>,
	opts: { markExistingAsRead: boolean; keepUnread?: number } = {
		markExistingAsRead: false,
	},
) {
	if (entries.length === 0) return 0;
	const inserted = await db
		.insert(items)
		.values(
			entries.map((e, i) => ({
				feedId,
				...e,
				// New subscriptions: only the newest `keepUnread` arrive unread.
				readAt:
					opts.markExistingAsRead && i >= (opts.keepUnread ?? 5)
						? new Date()
						: null,
			})),
		)
		.onConflictDoNothing({ target: [items.feedId, items.guid] })
		.returning({ id: items.id });
	return inserted.length;
}

/**
 * Full dump of a user's items with tags, for client mirrors
 * (macOS app sync). Personal scale — one user's whole corpus fits in memory.
 */
export async function listItemsForSync(db: Db, userId: string) {
	const rows = await db
		.select()
		.from(items)
		.innerJoin(feeds, eq(items.feedId, feeds.id))
		.where(eq(feeds.userId, userId))
		.orderBy(desc(items.publishedAt));
	const ids = rows.map((r) => r.items.id);
	const tagRows =
		ids.length === 0
			? []
			: await db.select().from(itemTags).where(inArray(itemTags.itemId, ids));
	const tagsByItem = new Map<string, string[]>();
	for (const t of tagRows) {
		const list = tagsByItem.get(t.itemId) ?? [];
		list.push(t.tag);
		tagsByItem.set(t.itemId, list);
	}
	return rows.map((r) => ({
		item: r.items,
		tags: (tagsByItem.get(r.items.id) ?? []).sort(),
	}));
}
