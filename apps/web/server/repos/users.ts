import type { db as DB } from "@feedreader/db/client";
import { users } from "@feedreader/db/schema";
import { asc, count, eq } from "drizzle-orm";

type Db = typeof DB;

export async function countUsers(db: Db): Promise<number> {
	const [row] = await db.select({ n: count() }).from(users);
	return row?.n ?? 0;
}

/** Sign-up order; ties (same instant) fall back to id so the answer is stable. */
export async function listUsers(db: Db) {
	return db.select().from(users).orderBy(asc(users.createdAt), asc(users.id));
}

export async function getUserById(db: Db, id: string) {
	const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
	return user ?? null;
}

export async function getUserByEmail(db: Db, email: string) {
	const [user] = await db
		.select()
		.from(users)
		.where(eq(users.email, email))
		.limit(1);
	return user ?? null;
}

/** Sessions, accounts, feeds, items and invites cascade from the FK constraints. */
export async function deleteUser(db: Db, id: string): Promise<boolean> {
	const rows = await db
		.delete(users)
		.where(eq(users.id, id))
		.returning({ id: users.id });
	return rows.length > 0;
}
