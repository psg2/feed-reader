import { sql } from "drizzle-orm";
import {
	boolean,
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { pk, timestamps } from "./helpers";
import { users } from "./users";

export const feeds = pgTable(
	"feeds",
	{
		...pk,
		userId: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		title: text().notNull(),
		url: text().notNull(),
		siteUrl: text(),
		category: text(),
		enabled: boolean().notNull().default(true),
		/** Sempre carregar a página completa no lugar do conteúdo do feed (feeds só-resumo). */
		fullPage: boolean().notNull().default(false),
		lastFetchedAt: timestamp({ withTimezone: true }),
		lastError: text(),
		...timestamps,
	},
	(t) => [unique().on(t.userId, t.url)],
);

export const items = pgTable(
	"items",
	{
		...pk,
		feedId: uuid()
			.notNull()
			.references(() => feeds.id, { onDelete: "cascade" }),
		guid: text().notNull(),
		link: text(),
		title: text().notNull(),
		author: text(),
		publishedAt: timestamp({ withTimezone: true }),
		contentHtml: text(),
		contentText: text(),
		readAt: timestamp({ withTimezone: true }),
		starred: boolean().notNull().default(false),
		notes: text(),
		...timestamps,
	},
	(t) => [
		unique().on(t.feedId, t.guid),
		index("items_published_at_idx").on(t.publishedAt),
		index("items_read_at_idx").on(t.readAt),
		// Per-feed listing, newest first.
		index("items_feed_published_idx").on(t.feedId, t.publishedAt.desc()),
		// Unread and starred views (items reach the user through feeds.user_id).
		index("items_unread_feed_published_idx")
			.on(t.feedId, t.publishedAt.desc())
			.where(sql`${t.readAt} IS NULL`),
		index("items_starred_feed_published_idx")
			.on(t.feedId, t.publishedAt.desc())
			.where(sql`${t.starred}`),
	],
);

export const itemTags = pgTable(
	"item_tags",
	{
		itemId: uuid()
			.notNull()
			.references(() => items.id, { onDelete: "cascade" }),
		tag: text().notNull(),
	},
	(t) => [unique().on(t.itemId, t.tag), index("item_tags_tag_idx").on(t.tag)],
);
