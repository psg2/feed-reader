import { oc } from "@orpc/contract";
import { z } from "zod";
import { readerValidators } from "../inputs/reader";
import {
	connectedApp,
	opmlImportResult,
	readerFeed,
	readerItem,
	readerItemDetail,
	refreshSummary,
	syncDump,
} from "../outputs/reader";

/** Reader API — same semantics as the macOS ToolService/AppDatabase. */
export const readerContract = {
	listItems: oc
		.route({ method: "POST", path: "/reader/items/list" })
		.input(readerValidators.listItems)
		.output(z.array(readerItem)),
	getItem: oc
		.route({ method: "GET", path: "/reader/items/{itemId}" })
		.input(readerValidators.getItem)
		.output(readerItemDetail.nullable()),
	updateItem: oc
		.route({ method: "PATCH", path: "/reader/items/{itemId}" })
		.input(readerValidators.updateItem)
		.output(readerItem.nullable()),
	markRead: oc
		.route({ method: "POST", path: "/reader/items/mark-read" })
		.input(readerValidators.markRead)
		.output(z.object({ changed: z.array(z.string().uuid()) })),
	markAllRead: oc
		.route({ method: "POST", path: "/reader/items/mark-all-read" })
		.input(readerValidators.markAllRead)
		.output(z.object({ changed: z.array(z.string().uuid()) })),
	listFeeds: oc
		.route({ method: "GET", path: "/reader/feeds" })
		.input(readerValidators.listFeeds)
		.output(z.array(readerFeed)),
	subscribe: oc
		.route({ method: "POST", path: "/reader/feeds" })
		.input(readerValidators.subscribe)
		.output(readerFeed),
	updateFeed: oc
		.route({ method: "PATCH", path: "/reader/feeds/{feedId}" })
		.input(readerValidators.updateFeed)
		.output(readerFeed.nullable()),
	removeFeed: oc
		.route({ method: "DELETE", path: "/reader/feeds/{feedId}" })
		.input(readerValidators.removeFeed)
		.output(z.object({ success: z.boolean() })),
	listTags: oc
		.route({ method: "GET", path: "/reader/tags" })
		.input(readerValidators.listTags)
		.output(z.array(z.string())),
	refresh: oc
		.route({ method: "POST", path: "/reader/refresh" })
		.input(readerValidators.refresh)
		.output(refreshSummary),
	sync: oc
		.route({ method: "POST", path: "/reader/sync" })
		.input(readerValidators.sync)
		.output(syncDump),
	inboundAddress: oc
		.route({ method: "GET", path: "/reader/inbound-address" })
		.input(readerValidators.inboundAddress)
		.output(z.object({ domain: z.string().nullable() })),
	connectedApps: oc
		.route({ method: "GET", path: "/reader/connected-apps" })
		.input(readerValidators.connectedApps)
		.output(z.array(connectedApp)),
	revokeApp: oc
		.route({ method: "POST", path: "/reader/connected-apps/revoke" })
		.input(readerValidators.revokeApp)
		.output(z.object({ success: z.boolean() })),
	importOpml: oc
		.route({ method: "POST", path: "/reader/opml/import" })
		.input(readerValidators.importOpml)
		.output(opmlImportResult),
};
