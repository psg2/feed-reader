import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { assertPublicUrl, FeedError } from "@/server/lib/feedfetch";
import type { ItemFilter } from "@/server/repos/items";
import * as reader from "@/server/usecases/reader";
import type { McpContext } from "../types";

/**
 * Reader MCP tools — the same surface the stdio feedreader-mcp binary
 * exposed, served over Streamable HTTP with OAuth. Ids are UUID strings.
 */

function parseFilter(filter: string | undefined): ItemFilter {
	if (!filter || filter === "unread") return { kind: "unread" };
	if (filter === "all") return { kind: "all" };
	if (filter === "starred") return { kind: "starred" };
	if (filter.startsWith("feed:"))
		return { kind: "feed", feedId: filter.slice(5) };
	if (filter.startsWith("tag:")) return { kind: "tag", tag: filter.slice(4) };
	return { kind: "unread" };
}

function json(value: unknown) {
	return {
		content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
	};
}

const id = z.string().uuid().describe("Item id");

export function registerReaderTools(
	server: McpServer,
	getCtx: () => McpContext,
): void {
	server.registerTool(
		"list_items",
		{
			description:
				"List posts. filter: unread (default), all, starred, feed:<id>, tag:<name>. Optional search over title, text and notes.",
			inputSchema: {
				filter: z
					.string()
					.optional()
					.describe("unread | all | starred | feed:<id> | tag:<name>"),
				search: z
					.string()
					.optional()
					.describe("Substring to search in title, content and notes"),
				limit: z.number().int().optional().describe("Max rows, default 50"),
			},
		},
		async ({ filter, search, limit }) => {
			const { db, userId } = getCtx();
			const items = await reader.listItems(db, userId, {
				filter: parseFilter(filter),
				search: search ?? "",
				limit: limit ?? 50,
			});
			return json(
				items.map((i) => ({
					id: i.id,
					title: i.title,
					feedTitle: i.feedTitle,
					link: i.link,
					publishedAt: i.publishedAt,
					read: i.readAt !== null,
					starred: i.starred,
					hasNotes: (i.notes ?? "") !== "",
				})),
			);
		},
	);

	server.registerTool(
		"get_item",
		{
			description: "Full post: plain-text content, notes and tags.",
			inputSchema: {
				id,
				max_chars: z
					.number()
					.int()
					.optional()
					.describe("Truncate content to this many characters (default 20000)"),
			},
		},
		async ({ id: itemId, max_chars }) => {
			const { db, userId } = getCtx();
			const item = await reader.getItem(db, userId, itemId);
			if (!item) return json({ error: `No item with id ${itemId}` });
			const maxChars = max_chars ?? 20_000;
			const text = item.contentText ?? "";
			return json({
				id: item.id,
				title: item.title,
				feedTitle: item.feedTitle,
				link: item.link,
				author: item.author,
				publishedAt: item.publishedAt,
				read: item.readAt !== null,
				starred: item.starred,
				tags: item.tags,
				notes: item.notes,
				content: text.slice(0, maxChars),
				contentTruncated: text.length > maxChars,
			});
		},
	);

	server.registerTool(
		"list_feeds",
		{
			description: "Subscribed feeds with unread counts and last fetch status.",
		},
		async () => {
			const { db, userId } = getCtx();
			return json(await reader.listFeeds(db, userId));
		},
	);

	server.registerTool(
		"list_tags",
		{ description: "All tags in use." },
		async () => {
			const { db, userId } = getCtx();
			return json(await reader.listTags(db, userId));
		},
	);

	server.registerTool(
		"mark_read",
		{
			description: "Mark a post read (or unread with read=false).",
			inputSchema: {
				id,
				read: z.boolean().optional().describe("Default true"),
			},
		},
		async ({ id: itemId, read }) => {
			const { db, userId } = getCtx();
			await reader.markRead(db, userId, [itemId], read ?? true);
			return json({ id: itemId, read: read ?? true });
		},
	);

	server.registerTool(
		"star",
		{
			description: "Star or unstar a post.",
			inputSchema: {
				id,
				starred: z.boolean().optional().describe("Default true"),
			},
		},
		async ({ id: itemId, starred }) => {
			const { db, userId } = getCtx();
			await reader.updateItem(db, userId, itemId, {
				starred: starred ?? true,
			});
			return json({ id: itemId, starred: starred ?? true });
		},
	);

	server.registerTool(
		"add_note",
		{
			description:
				"Write the user's notes on a post. Appends a paragraph unless replace=true.",
			inputSchema: {
				id,
				notes: z.string().describe("Markdown text"),
				replace: z.boolean().optional().describe("Replace instead of append"),
			},
		},
		async ({ id: itemId, notes, replace }) => {
			const { db, userId } = getCtx();
			let value = notes;
			if (!replace) {
				const existing = (await reader.getItem(db, userId, itemId))?.notes;
				if (existing) value = `${existing}\n\n${notes}`;
			}
			await reader.updateItem(db, userId, itemId, { notes: value });
			return json({ id: itemId, notes: value });
		},
	);

	server.registerTool(
		"add_tags",
		{
			description:
				"Add tags to a post (union with existing unless replace=true).",
			inputSchema: {
				id,
				tags: z.array(z.string()).describe("Tags"),
				replace: z.boolean().optional().describe("Replace instead of add"),
			},
		},
		async ({ id: itemId, tags, replace }) => {
			const { db, userId } = getCtx();
			let value = tags;
			if (!replace) {
				const existing = (await reader.getItem(db, userId, itemId))?.tags ?? [];
				value = [...new Set([...existing, ...tags])].sort();
			}
			await reader.updateItem(db, userId, itemId, { tags: value });
			return json({ id: itemId, tags: value });
		},
	);

	server.registerTool(
		"subscribe",
		{
			description:
				"Subscribe to a feed. Accepts a feed URL or a site/post URL (autodiscovery).",
			inputSchema: {
				url: z.string().describe("Feed or site URL"),
				category: z.string().optional().describe("Optional category"),
			},
		},
		async ({ url, category }) => {
			const { db, userId } = getCtx();
			try {
				await assertPublicUrl(new URL(url));
				const feed = await reader.subscribe(db, userId, { url, category });
				return json({ id: feed.id, title: feed.title, url: feed.url });
			} catch (err) {
				// The feed URL is the user's; say what went wrong without a stack.
				if (err instanceof FeedError || err instanceof TypeError)
					return json({
						error:
							err instanceof FeedError ? err.message : `Invalid URL: ${url}`,
					});
				throw err;
			}
		},
	);

	server.registerTool(
		"refresh",
		{ description: "Fetch all enabled feeds now (on the server)." },
		async () => {
			const { db, userId } = getCtx();
			return json(await reader.refresh(db, userId));
		},
	);
}
