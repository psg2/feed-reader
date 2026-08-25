/**
 * Environment shared by the Playwright config and the test fixtures.
 *
 * The app under test runs on a plain http port (no portless), so BetterAuth
 * answers with ordinary redirects and cookies. Values come from the repo's
 * .env files unless already set in the environment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../..",
);

function loadEnvFile(file: string) {
	if (!fs.existsSync(file)) return;
	for (const line of fs.readFileSync(file, "utf8").split("\n")) {
		const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(
			line,
		);
		if (!m || line.trim().startsWith("#")) continue;
		const value = m[2].replace(/^(["'])(.*)\1$/, "$2").replace(/\s+#.*$/, "");
		if (process.env[m[1]] === undefined) process.env[m[1]] = value;
	}
}

for (const f of [".env", ".env.docker", ".env.local"]) {
	loadEnvFile(path.join(ROOT, f));
}

export const PORT = Number(process.env.E2E_PORT ?? 3123);
export const BASE_URL = `http://localhost:${PORT}`;

export const FIXTURE_PORT = Number(process.env.E2E_FIXTURE_PORT ?? 4567);
export const FIXTURE_BASE = `http://127.0.0.1:${FIXTURE_PORT}`;

/** Feeds served from tests/fixtures by e2e/fixture-server.mjs. */
export const FEEDS = {
	/** RSS, 10 items, "Irrational Exuberance". */
	lethain: `${FIXTURE_BASE}/lethain.xml`,
	/** Atom, 30 entries, "Simon Willison's Weblog". */
	simon: `${FIXTURE_BASE}/simonwillison.xml`,
	/** Same files under another path: a distinct subscription with the same content. */
	lethainCopy: `${FIXTURE_BASE}/copy/lethain.xml`,
	missing: `${FIXTURE_BASE}/missing.xml`,
} as const;

export const DATABASE_URL = process.env.POSTGRES_URL ?? "";

/** Accounts created by global-setup.ts, one per parallel worker slot. */
export const ACCOUNTS_FILE = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	".auth/accounts.json",
);
