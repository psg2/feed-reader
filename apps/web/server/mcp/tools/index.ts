import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpContext } from "../types";
import { registerReaderTools } from "./reader";

/**
 * Register all MCP tools on the server.
 * Add new domain tool registrations here as you build them.
 */
export function registerAllTools(
	server: McpServer,
	getCtx: () => McpContext,
): void {
	registerReaderTools(server, getCtx);
}
