import { boolean, pgTable, text } from "drizzle-orm/pg-core";
import { pk, timestamps } from "./helpers";

export const users = pgTable("auth_users", {
	...pk,
	// ── BetterAuth core fields ────────────────────────────────────────
	name: text().notNull().default(""),
	email: text().notNull().unique(),
	emailVerified: boolean().default(false).notNull(),
	imageUrl: text(),
	// ── BetterAuth 2FA plugin field ────────────────────────────────────
	twoFactorEnabled: boolean(),
	...timestamps,
});
