import { drizzle } from "drizzle-orm/postgres-js";
import { PostgresJsPreparedQuery } from "drizzle-orm/postgres-js/session";
import postgres from "postgres";

import * as schema from "./schema";

// ── Slow query logging ────────────────────────────────────────────────────

/**
 * Patches PostgresJsPreparedQuery.prototype to log queries exceeding the
 * threshold. Threshold configurable via SLOW_QUERY_MS env var (default: 200ms).
 */
function applySlowQueryLog(): void {
	const threshold = Number(process.env.SLOW_QUERY_MS ?? 200);

	function logIfSlow(
		start: number,
		self: PostgresJsPreparedQuery<never>,
	): void {
		const duration_ms = Math.round(performance.now() - start);
		if (duration_ms < threshold) return;
		// queryString is a private field on PostgresJsPreparedQuery; Reflect bypasses the type-only access check.
		const query =
			(Reflect.get(self, "queryString") as string | undefined) ?? "";
		console.warn("[db] slow_query", {
			duration_ms,
			query: query.slice(0, 300),
		});
	}

	const originalExecute = PostgresJsPreparedQuery.prototype.execute;
	PostgresJsPreparedQuery.prototype.execute = async function (
		this: PostgresJsPreparedQuery<never>,
		placeholderValues?: Record<string, unknown>,
	) {
		const start = performance.now();
		try {
			return await originalExecute.call(this, placeholderValues);
		} finally {
			logIfSlow(start, this);
		}
	};

	const originalAll = PostgresJsPreparedQuery.prototype.all;
	PostgresJsPreparedQuery.prototype.all = async function (
		this: PostgresJsPreparedQuery<never>,
		placeholderValues?: Record<string, unknown>,
	) {
		const start = performance.now();
		try {
			return await originalAll.call(this, placeholderValues);
		} finally {
			logIfSlow(start, this);
		}
	};
}

applySlowQueryLog();

// ── DB factory ────────────────────────────────────────────────────────────

/**
 * Create a Drizzle database instance with the given connection URL.
 *
 * Returns `{ db, end }` — call `end()` to cleanly close the connection pool.
 * Use this in scripts, tests, or apps that validate env vars before connecting.
 */
export function createDb(
	url: string,
	options?: { max?: number; idleTimeout?: number; maxLifetime?: number },
): { db: ReturnType<typeof drizzle<typeof schema>>; end: () => Promise<void> } {
	const pool = postgres(url, {
		onnotice: () => {},
		max: options?.max ?? 10,
		idle_timeout: options?.idleTimeout ?? 20,
		max_lifetime: options?.maxLifetime ?? 60 * 5,
	});

	return {
		db: drizzle(pool, { schema, casing: "snake_case" }),
		end: () => pool.end(),
	};
}

// ── Default singleton ─────────────────────────────────────────────────────

// Survive HMR — reuse the same pool across module reloads.
const globalForDb = globalThis as unknown as {
	_pgPool?: ReturnType<typeof postgres>;
};

function getDefaultUrl(): string {
	const url = process.env.POSTGRES_URL;
	if (!url) throw new Error("POSTGRES_URL environment variable is not set");
	return url;
}

if (!globalForDb._pgPool) {
	globalForDb._pgPool = postgres(getDefaultUrl(), {
		// Drizzle migrations emit "relation already exists, skipping" notices.
		onnotice: () => {},
		max: 10,
		idle_timeout: 20,
		max_lifetime: 60 * 5,
	});
}

/** Default HMR-safe database instance. Reads POSTGRES_URL from process.env. */
export const db = drizzle(globalForDb._pgPool, {
	schema,
	casing: "snake_case",
});

export type Database = typeof db;
