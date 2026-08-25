/**
 * Creates one account per parallel worker slot before any test runs.
 *
 * BetterAuth rate-limits sign-up and sign-in to five a minute per IP, so
 * accounts are made once here and handed to workers by `parallelIndex`
 * (see fixtures.ts); a worker restarted after a failure keeps its slot.
 */
import fs from "node:fs";
import path from "node:path";
import type { FullConfig } from "@playwright/test";
import postgres from "postgres";
import { ACCOUNTS_FILE, DATABASE_URL } from "./env";
import { type Account, createAccount } from "./fixtures";

export default async function globalSetup(config: FullConfig) {
	if (!DATABASE_URL) throw new Error("POSTGRES_URL is not set for e2e");
	const sql = postgres(DATABASE_URL, { max: 1 });
	try {
		const accounts: Account[] = [];
		for (let i = 0; i < config.workers; i++) {
			accounts.push(await createAccount(sql, i));
		}
		fs.mkdirSync(path.dirname(ACCOUNTS_FILE), { recursive: true });
		fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(accounts));
	} finally {
		await sql.end();
	}
}
