/**
 * Database seed script — populates Postgres with demo data.
 *
 * Run: pnpm db:seed
 *
 * Creates:
 * - Admin user (admin@example.com)
 * - Regular user (user@example.com)
 */

import { hashPassword } from "better-auth/crypto";
import { createDb } from "./client";
import { users } from "./schema/index";

// ── Production guard (defense-in-depth) ──────────────────────────────────────
// The Vercel build gates seeding to preview (vercel.json), but a stray run — a
// manual `pnpm db:seed`, a build misconfig, or a preview that shares the prod
// database — must never write demo data (incl. a public-password admin) into
// production. Refuse on a production deployment, skipping cleanly (exit 0) so a
// build chain isn't broken. Local dev leaves VERCEL_ENV unset, so seeding there
// still works.
if (process.env.VERCEL_ENV === "production") {
	console.log(
		"⏭️  VERCEL_ENV=production — refusing to seed production. Skipping.",
	);
	process.exit(0);
}

const url = process.env.POSTGRES_URL ?? "postgres://dev:dev@localhost:5435/app";
const { db, end } = createDb(url);

// Deterministic UUIDs for seed entities — tests can rely on these.
const SEED_IDS = {
	admin: "a0000000-0000-4000-8000-000000000001",
	user: "a0000000-0000-4000-8000-000000000002",
} as const;

async function seed() {
	console.log("🌱 Seeding database...");

	const password = await hashPassword("12345678");

	// ── Users ─────────────────────────────────────────────────────────────
	const [adminUser] = await db
		.insert(users)
		.values({
			id: SEED_IDS.admin,
			name: "Admin User",
			email: "admin@example.com",
			emailVerified: true,
		})
		.onConflictDoNothing()
		.returning();

	const [regularUser] = await db
		.insert(users)
		.values({
			id: SEED_IDS.user,
			name: "Demo User",
			email: "user@example.com",
			emailVerified: true,
		})
		.onConflictDoNothing()
		.returning();

	if (!adminUser || !regularUser) {
		console.log("  Users already exist, skipping...");
		await end();
		return;
	}

	// Create auth accounts with passwords
	const { authAccounts } = await import("./schema/auth");
	for (const user of [adminUser, regularUser]) {
		await db
			.insert(authAccounts)
			.values({
				id: crypto.randomUUID(),
				issuer: "local:credential",
				accountId: user.id,
				providerId: "credential",
				userId: user.id,
				password,
			})
			.onConflictDoNothing();
	}

	console.log(
		"  ✓ Users: admin@example.com, user@example.com (password: 12345678)",
	);

	console.log("\n✅ Seed complete!");
	await end();
}

seed().catch((err) => {
	console.error("Seed failed:", err);
	process.exit(1);
});
