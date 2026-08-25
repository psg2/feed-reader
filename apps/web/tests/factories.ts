/**
 * Test data factories — composable helpers that insert real rows into the
 * test database and return the created objects.
 *
 * Each factory uses sensible defaults and accepts overrides.
 * All writes happen inside the test's rolled-back transaction.
 *
 * Usage:
 *   import { getTestDb } from "@/tests/setup";
 *   import { createTestUser } from "@/tests/factories";
 *
 *   const db = getTestDb();
 *   const user = await createTestUser(db);
 */
import { randomUUID } from "node:crypto";
import type { Database } from "@feedreader/db/client";
import { users } from "@feedreader/db/schema";

// ── Counter for unique defaults ───────────────────────────────────────────

let seq = 0;
function nextSeq(): number {
	return ++seq;
}

// ── Users ─────────────────────────────────────────────────────────────────

type UserRow = typeof users.$inferSelect;

export async function createTestUser(
	db: Database,
	overrides: Partial<typeof users.$inferInsert> = {},
): Promise<UserRow> {
	const n = nextSeq();
	const [row] = await db
		.insert(users)
		.values({
			name: overrides.name ?? `Test User ${n}`,
			email:
				overrides.email ?? `test-${n}-${randomUUID().slice(0, 8)}@example.com`,
			emailVerified: overrides.emailVerified ?? true,
			...overrides,
		})
		.returning();
	return row!;
}
