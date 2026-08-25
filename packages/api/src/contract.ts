import { adminContract } from "./contracts/admin";
import { readerContract } from "./contracts/reader";

/**
 * Full API contract — the single source of truth for the API surface.
 *
 * Inputs come from Zod validators (what was @feedreader/validators).
 * Outputs are Zod schemas for response shapes.
 *
 * Usage:
 * - Server: `implement(contract)` for type-checked route handlers
 * - Client: `createORPCClient<typeof contract>(link)` for typed calls
 */
export const contract = {
	reader: readerContract,
	admin: adminContract,
};
