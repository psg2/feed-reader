/**
 * Inferred TypeScript types from API output schemas.
 *
 * Client components should import types from here instead of from
 * server usecases/repos/domain modules.
 */
import type { z } from "zod";
import type { adminInvite, adminUser, createdInvite } from "./outputs/admin";
import type {
	connectedApp,
	opmlImportResult,
	readerFeed,
	readerItem,
	readerItemDetail,
	refreshSummary,
} from "./outputs/reader";

export type ReaderItem = z.infer<typeof readerItem>;
export type ReaderItemDetail = z.infer<typeof readerItemDetail>;
export type ReaderFeed = z.infer<typeof readerFeed>;
export type RefreshSummary = z.infer<typeof refreshSummary>;
export type ConnectedApp = z.infer<typeof connectedApp>;
export type OpmlImportResult = z.infer<typeof opmlImportResult>;
export type ReaderFilter =
	| { kind: "unread" }
	| { kind: "all" }
	| { kind: "starred" }
	| { kind: "feed"; feedId: string }
	| { kind: "tag"; tag: string };
export type AdminUser = z.infer<typeof adminUser>;
export type AdminInvite = z.infer<typeof adminInvite>;
export type CreatedInvite = z.infer<typeof createdInvite>;
