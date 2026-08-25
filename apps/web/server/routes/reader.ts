import { db } from "@feedreader/db/client";
import { ORPCError } from "@orpc/server";
import { FeedError } from "@/server/lib/feedfetch";
import * as reader from "@/server/usecases/reader";
import { authed } from "./base";

export const readerRouter = {
	listItems: authed.reader.listItems.handler(async ({ context, input }) => {
		return reader.listItems(db, context.userId, input);
	}),
	getItem: authed.reader.getItem.handler(async ({ context, input }) => {
		return reader.getItem(db, context.userId, input.itemId);
	}),
	updateItem: authed.reader.updateItem.handler(async ({ context, input }) => {
		const { itemId, ...data } = input;
		return reader.updateItem(db, context.userId, itemId, data);
	}),
	markRead: authed.reader.markRead.handler(async ({ context, input }) => {
		return {
			changed: await reader.markRead(
				db,
				context.userId,
				input.itemIds,
				input.read,
			),
		};
	}),
	markAllRead: authed.reader.markAllRead.handler(async ({ context, input }) => {
		return {
			changed: await reader.markAllRead(db, context.userId, input),
		};
	}),
	listFeeds: authed.reader.listFeeds.handler(async ({ context }) => {
		return reader.listFeeds(db, context.userId);
	}),
	subscribe: authed.reader.subscribe.handler(async ({ context, input }) => {
		try {
			return await reader.subscribe(db, context.userId, input);
		} catch (err) {
			// The feed, not the server, is at fault: say so instead of a 500.
			if (err instanceof FeedError)
				throw new ORPCError("BAD_REQUEST", { message: err.message });
			throw err;
		}
	}),
	updateFeed: authed.reader.updateFeed.handler(async ({ context, input }) => {
		const { feedId, ...data } = input;
		return reader.updateFeed(db, context.userId, feedId, data);
	}),
	removeFeed: authed.reader.removeFeed.handler(async ({ context, input }) => {
		await reader.removeFeed(db, context.userId, input.feedId);
		return { success: true };
	}),
	listTags: authed.reader.listTags.handler(async ({ context }) => {
		return reader.listTags(db, context.userId);
	}),
	refresh: authed.reader.refresh.handler(async ({ context }) => {
		return reader.refresh(db, context.userId);
	}),
	sync: authed.reader.sync.handler(async ({ context }) => {
		return reader.syncDump(db, context.userId);
	}),
	inboundAddress: authed.reader.inboundAddress.handler(async () => {
		return reader.inboundAddress();
	}),
	connectedApps: authed.reader.connectedApps.handler(async ({ context }) => {
		return reader.connectedApps(db, context.userId);
	}),
	revokeApp: authed.reader.revokeApp.handler(async ({ context, input }) => {
		await reader.revokeApp(db, context.userId, input.clientId);
		return { success: true };
	}),
	importOpml: authed.reader.importOpml.handler(async ({ context, input }) => {
		try {
			return await reader.importOpml(db, context.userId, input.xml);
		} catch (err) {
			if (err instanceof FeedError)
				throw new ORPCError("BAD_REQUEST", { message: err.message });
			throw err;
		}
	}),
};
