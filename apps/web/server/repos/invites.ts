import type { db as DB } from "@feedreader/db/client";
import { invites } from "@feedreader/db/schema";
import { and, desc, eq, isNull } from "drizzle-orm";

type Db = typeof DB;

export type InviteRow = typeof invites.$inferSelect;

export async function listInvites(db: Db): Promise<InviteRow[]> {
	return db.select().from(invites).orderBy(desc(invites.createdAt));
}

export async function getInviteByTokenHash(
	db: Db,
	tokenHash: string,
): Promise<InviteRow | null> {
	const [row] = await db
		.select()
		.from(invites)
		.where(eq(invites.tokenHash, tokenHash))
		.limit(1);
	return row ?? null;
}

export async function createInvite(
	db: Db,
	data: {
		email: string;
		tokenHash: string;
		invitedBy: string;
		expiresAt: Date;
	},
): Promise<InviteRow> {
	const [row] = await db.insert(invites).values(data).returning();
	return row;
}

/** Removes the not-yet-accepted invites for an address (re-invite replaces them). */
export async function deletePendingInvitesForEmail(
	db: Db,
	email: string,
): Promise<void> {
	await db
		.delete(invites)
		.where(and(eq(invites.email, email), isNull(invites.acceptedAt)));
}

export async function deleteInvite(db: Db, id: string): Promise<boolean> {
	const rows = await db
		.delete(invites)
		.where(eq(invites.id, id))
		.returning({ id: invites.id });
	return rows.length > 0;
}

export async function markInviteAccepted(
	db: Db,
	id: string,
	at: Date,
): Promise<void> {
	await db
		.update(invites)
		.set({ acceptedAt: at })
		.where(and(eq(invites.id, id), isNull(invites.acceptedAt)));
}
