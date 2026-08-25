/**
 * Full database reset: drop all tables, re-push schema, re-seed.
 *
 * Safety checks:
 * - URL must point to localhost / 127.0.0.1
 * - Database name must end with "_dev" or "_test", or be exactly "app"
 *
 * Usage: pnpm db:reset
 */

import { execSync } from "node:child_process";
import path from "node:path";
import postgres from "postgres";

const pkgDir = path.resolve(import.meta.dirname, "..");

const url = process.env.POSTGRES_URL ?? "postgres://dev:dev@localhost:5435/app";

// ── Safety checks ─────────────────────────────────────────────────────────

const parsed = new URL(url);

const isLocalhost =
	parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
if (!isLocalhost) {
	console.error(
		`❌ Refusing to reset non-localhost database: ${parsed.hostname}`,
	);
	process.exit(1);
}

const dbName = parsed.pathname.replace("/", "");
const safeNames = ["app", "app_dev", "app_test"];
if (
	!safeNames.includes(dbName) &&
	!dbName.endsWith("_dev") &&
	!dbName.endsWith("_test")
) {
	console.error(
		`❌ Refusing to reset database with unexpected name: ${dbName}`,
	);
	process.exit(1);
}

// ── Reset ─────────────────────────────────────────────────────────────────

console.log(`🗑️  Resetting database: ${dbName} @ ${parsed.hostname}`);

const sql = postgres(url);

await sql.unsafe("DROP SCHEMA IF EXISTS drizzle CASCADE");
await sql.unsafe("DROP SCHEMA public CASCADE");
await sql.unsafe("CREATE SCHEMA public");
await sql.end();

console.log("✅ Schema dropped");

// ── Apply migrations ────────────────────────────────────────────────────────
// Migrations are the single source of truth (same path as production). Never
// `drizzle-kit push` — it bypasses migration history and drifts dev from drizzle/.

console.log("📦 Applying migrations...");
execSync("pnpm exec drizzle-kit migrate", {
	cwd: pkgDir,
	stdio: "inherit",
	env: { ...process.env, POSTGRES_URL: url },
});

// ── Seed ──────────────────────────────────────────────────────────────────

console.log("🌱 Seeding...");
execSync("tsx src/seed.ts", {
	cwd: pkgDir,
	stdio: "inherit",
	env: { ...process.env, POSTGRES_URL: url },
});

console.log("\n🎉 Database reset complete!");
