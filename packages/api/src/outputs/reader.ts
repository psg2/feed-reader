import { z } from "zod";

export const readerItem = z.object({
	id: z.string().uuid(),
	feedId: z.string().uuid(),
	feedTitle: z.string(),
	guid: z.string(),
	link: z.string().nullable(),
	title: z.string(),
	author: z.string().nullable(),
	publishedAt: z.date().nullable(),
	readAt: z.date().nullable(),
	starred: z.boolean(),
	notes: z.string().nullable(),
});

export const readerItemDetail = readerItem.extend({
	contentHtml: z.string().nullable(),
	contentText: z.string().nullable(),
	feedFullPage: z.boolean(),
	tags: z.array(z.string()),
});

export const readerFeed = z.object({
	id: z.string().uuid(),
	title: z.string(),
	url: z.string(),
	siteUrl: z.string().nullable(),
	category: z.string().nullable(),
	enabled: z.boolean(),
	fullPage: z.boolean(),
	unread: z.number().int(),
	lastFetchedAt: z.date().nullable(),
	lastError: z.string().nullable(),
});

export const connectedApp = z.object({
	consentId: z.string().uuid(),
	clientId: z.string(),
	name: z.string(),
	icon: z.string().nullable(),
	uri: z.string().nullable(),
	scopes: z.array(z.string()),
	grantedAt: z.date(),
});

export const opmlImportResult = z.object({
	added: z.number().int(),
	skipped: z.number().int(),
	failed: z.array(z.object({ url: z.string(), error: z.string() })),
});

export const refreshSummary = z.object({
	feedsChecked: z.number().int(),
	feedsFailed: z.number().int(),
	newItems: z.number().int(),
});

/**
 * Full-mirror dump for native clients (macOS app). Dates travel as ISO-8601
 * strings so non-oRPC consumers (Swift URLSession) can decode plain JSON.
 */
export const syncDump = z.object({
	feeds: z.array(
		z.object({
			id: z.string().uuid(),
			title: z.string(),
			url: z.string(),
			siteUrl: z.string().nullable(),
			category: z.string().nullable(),
			enabled: z.boolean(),
			fullPage: z.boolean(),
			lastFetchedAt: z.string().nullable(),
			lastError: z.string().nullable(),
		}),
	),
	items: z.array(
		z.object({
			id: z.string().uuid(),
			feedId: z.string().uuid(),
			guid: z.string(),
			link: z.string().nullable(),
			title: z.string(),
			author: z.string().nullable(),
			publishedAt: z.string().nullable(),
			contentHtml: z.string().nullable(),
			contentText: z.string().nullable(),
			readAt: z.string().nullable(),
			starred: z.boolean(),
			notes: z.string().nullable(),
			tags: z.array(z.string()),
		}),
	),
});
