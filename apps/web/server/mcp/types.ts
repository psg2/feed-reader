import type { Database } from "@feedreader/db/client";

/** Context passed to MCP tools — resolved from the bearer token. */
export interface McpContext {
	db: Database;
	userId: string;
}
