/**
 * Global test setup — provides a per-test isolated database handle.
 *
 * Strategy: before each test, we start a Postgres transaction and expose
 * a Drizzle `db` handle scoped to it. After the test, we ROLLBACK so no
 * data persists. Tests are fully isolated and idempotent.
 *
 * Component tests (happy-dom) skip DB setup entirely — they don't need it.
 *
 * Usage in test files:
 *   import { getTestDb } from "@/tests/setup";
 *   const db = getTestDb();
 */

import type { Database } from "@feedreader/db/client";
import type { Sql } from "postgres";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";

// ── Connection ────────────────────────────────────────────────────────────

// Derive test DB URL from POSTGRES_URL (replace db name with app_test)
// or use TEST_DATABASE_URL if explicitly set.
function getTestDatabaseUrl(): string {
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
	const base =
		process.env.POSTGRES_URL ?? "postgres://dev:dev@localhost:5435/app";
	return base.replace(/\/[^/]+$/, "/app_test");
}

const TEST_DATABASE_URL = getTestDatabaseUrl();

// Skip DB setup for component tests running in happy-dom.
// `typeof window` is 'undefined' in node but 'object' in happy-dom.
const isNodeEnv = typeof window === "undefined";

let pool!: Sql;
let currentDb: Database;

// ── Lifecycle ─────────────────────────────────────────────────────────────

if (isNodeEnv) {
	beforeAll(async () => {
		// Dynamic import so happy-dom tests don't load postgres/drizzle at all
		const { default: postgres } = await import("postgres");
		pool = postgres(TEST_DATABASE_URL, {
			max: 1,
			idle_timeout: 20,
			max_lifetime: 60 * 5,
		});

		// Smoke test: make sure the test database is reachable
		const [{ ok }] = await pool`SELECT 1 AS ok`;
		if (ok !== 1) throw new Error("Test database not reachable");
	});

	beforeEach(async () => {
		const schema = await import("@feedreader/db/schema");
		const { drizzle } = await import("drizzle-orm/postgres-js");
		// BEGIN a transaction — everything the test writes lives inside this tx.
		await pool`BEGIN`;
		currentDb = drizzle(pool, { schema, casing: "snake_case" });
	});

	afterEach(async () => {
		// ROLLBACK — all writes vanish, leaving a clean database for the next test.
		await pool`ROLLBACK`;
	});

	afterAll(async () => {
		await pool.end();
	});
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Returns the Drizzle database handle scoped to the current test's transaction.
 * Must be called inside a test (not at module level).
 */
export function getTestDb(): Database {
	if (!currentDb) {
		throw new Error(
			"getTestDb() called outside a test — did you forget beforeEach?",
		);
	}
	return currentDb;
}

/**
 * Assert a value is defined (not null/undefined) and narrow the type.
 * Use this instead of `!` non-null assertions for clear error messages.
 */
export function assertDefined<T>(
	value: T | null | undefined,
	label: string,
): asserts value is T {
	if (value == null) {
		throw new Error(`Expected ${label} to be defined, got ${String(value)}`);
	}
}
