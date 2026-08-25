import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { pk } from "./helpers";
import { users } from "./users";

/**
 * Sign-up invitations. Only the sha256 of the token is stored; the raw
 * token travels in the invite link once and is never shown again.
 */
export const invites = pgTable(
	"invites",
	{
		...pk,
		email: text().notNull(),
		tokenHash: text().notNull().unique(),
		invitedBy: uuid()
			.notNull()
			.references(() => users.id, { onDelete: "cascade" }),
		expiresAt: timestamp({ withTimezone: true }).notNull(),
		acceptedAt: timestamp({ withTimezone: true }),
		createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
	},
	(t) => [index("invites_email_idx").on(t.email)],
);
