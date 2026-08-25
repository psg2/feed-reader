import { z } from "zod";
import { uuid } from "./common";

const filter = z
	.union([
		z.object({ kind: z.literal("unread") }),
		z.object({ kind: z.literal("all") }),
		z.object({ kind: z.literal("starred") }),
		z.object({ kind: z.literal("feed"), feedId: uuid }),
		z.object({ kind: z.literal("tag"), tag: z.string().min(1) }),
	])
	.default({ kind: "unread" });

export const readerValidators = {
	listItems: z.object({
		filter,
		search: z.string().default(""),
		limit: z.number().int().min(1).max(500).default(50),
	}),
	getItem: z.object({ itemId: uuid }),
	updateItem: z.object({
		itemId: uuid,
		read: z.boolean().optional(),
		starred: z.boolean().optional(),
		notes: z.string().optional(),
		tags: z.array(z.string()).optional(),
	}),
	/** `filter` scopes the sweep to a view; `feedId` is the legacy single-feed form. */
	markAllRead: z.object({ feedId: uuid.optional(), filter: filter.optional() }),
	markRead: z.object({
		itemIds: z.array(uuid).min(1).max(5000),
		read: z.boolean(),
	}),
	listFeeds: z.object({}).optional(),
	subscribe: z.object({
		url: z.string().url(),
		category: z.string().optional(),
	}),
	updateFeed: z.object({
		feedId: uuid,
		title: z.string().min(1).optional(),
		category: z.string().nullable().optional(),
		enabled: z.boolean().optional(),
		fullPage: z.boolean().optional(),
	}),
	removeFeed: z.object({ feedId: uuid }),
	listTags: z.object({}).optional(),
	refresh: z.void(),
	sync: z.void(),
	inboundAddress: z.object({}).optional(),
	connectedApps: z.object({}).optional(),
	revokeApp: z.object({ clientId: z.string().min(1) }),
	importOpml: z.object({ xml: z.string().min(1).max(2_000_000) }),
};
