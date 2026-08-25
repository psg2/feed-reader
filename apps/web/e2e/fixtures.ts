/**
 * Test fixtures: one account per worker, a clean account per test.
 *
 * Sign-up goes through the BetterAuth API; the address is then verified
 * directly in the database (no mailbox in tests) and signed in, and the
 * resulting cookies become the browser context's storage state. Before each
 * test every feed of the account is deleted (items, tags and notes cascade),
 * so specs start from "no feeds" and seed what they need through the real
 * RPC endpoints.
 */
import {
	type APIRequestContext,
	type Page,
	expect,
	request as playwrightRequest,
	test as base,
} from "@playwright/test";
import fs from "node:fs";
import postgres from "postgres";
import { ACCOUNTS_FILE, BASE_URL, DATABASE_URL } from "./env";

export { expect };

type Sql = ReturnType<typeof postgres>;

export type Account = {
	email: string;
	password: string;
	userId: string;
	storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
};

export type Feed = { id: string; title: string; url: string; unread: number };
export type Item = {
	id: string;
	title: string;
	readAt: Date | null;
	starred: boolean;
};

/** Sends an auth request, waiting out BetterAuth's per-IP rate limit if hit. */
// (BetterAuth allows five sign-ups and five sign-ins a minute per IP, which
// is why accounts are created once in global-setup.ts rather than per worker.)
async function authPost(
	api: APIRequestContext,
	path: string,
	data: Record<string, string>,
) {
	for (let attempt = 0; attempt < 8; attempt++) {
		const res = await api.post(`${BASE_URL}/api/auth/${path}`, { data });
		if (res.status() !== 429) return res;
		const wait = Number(res.headers()["x-retry-after"] ?? 10);
		await new Promise((r) => setTimeout(r, Math.min(wait, 30) * 1000 + 500));
	}
	throw new Error(`Rate limited on ${path}`);
}

export async function createAccount(sql: Sql, index: number): Promise<Account> {
	const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	const email = `e2e-${index}-${stamp}@example.com`;
	const password = `pw-${stamp}-${index}`;
	const api = await playwrightRequest.newContext({
		baseURL: BASE_URL,
		extraHTTPHeaders: { origin: BASE_URL },
	});
	try {
		const signUp = await authPost(api, "sign-up/email", {
			name: "E2E Reader",
			email,
			password,
		});
		if (!signUp.ok()) {
			throw new Error(
				`Sign-up failed (${signUp.status()}): ${await signUp.text()}`,
			);
		}
		const [user] = await sql<{ id: string }[]>`
			update auth_users set email_verified = true where email = ${email} returning id
		`;
		if (!user) throw new Error(`No user row for ${email}`);
		const signIn = await authPost(api, "sign-in/email", { email, password });
		if (!signIn.ok()) {
			throw new Error(
				`Sign-in failed (${signIn.status()}): ${await signIn.text()}`,
			);
		}
		return {
			email,
			password,
			userId: user.id,
			storageState: await api.storageState(),
		};
	} finally {
		await api.dispose();
	}
}

/** Seeds data through the app's own RPC (cookies from the page) or the DB. */
export class Seeder {
	constructor(
		private readonly api: APIRequestContext,
		private readonly sql: Sql,
		readonly userId: string,
	) {}

	async subscribe(url: string): Promise<Feed> {
		const res = await this.api.post("/api/rpc/reader/subscribe", {
			data: { json: { url } },
		});
		expect(res.ok(), `subscribe ${url}: ${res.status()}`).toBeTruthy();
		return (await res.json()).json as Feed;
	}

	/** Items of the account (or one feed), newest first — the list order. */
	async items(feedId?: string): Promise<Item[]> {
		const rows = await this.sql<
			{ id: string; title: string; read_at: Date | null; starred: boolean }[]
		>`
			select i.id, i.title, i.read_at, i.starred
			from items i join feeds f on f.id = i.feed_id
			where f.user_id = ${this.userId}
			${feedId ? this.sql`and f.id = ${feedId}` : this.sql``}
			order by i.published_at desc, i.created_at desc
		`;
		return rows.map((r) => ({
			id: r.id,
			title: r.title,
			readAt: r.read_at,
			starred: r.starred,
		}));
	}

	async unreadCount(): Promise<number> {
		const [row] = await this.sql<{ n: string }[]>`
			select count(*)::text as n from items i join feeds f on f.id = i.feed_id
			where f.user_id = ${this.userId} and i.read_at is null
		`;
		return Number(row.n);
	}

	async item(id: string): Promise<{ notes: string | null; tags: string[] }> {
		const [row] = await this.sql<{ notes: string | null }[]>`
			select notes from items where id = ${id}
		`;
		const tags = await this.sql<{ tag: string }[]>`
			select tag from item_tags where item_id = ${id} order by tag
		`;
		return { notes: row?.notes ?? null, tags: tags.map((t) => t.tag) };
	}
}

type WorkerFixtures = { sql: Sql; account: Account };
type TestFixtures = { seed: Seeder };

export const test = base.extend<TestFixtures, WorkerFixtures>({
	sql: [
		// Playwright reads fixture dependencies off the destructuring pattern.
		// oxlint-disable-next-line no-empty-pattern
		async ({}, use) => {
			if (!DATABASE_URL) throw new Error("POSTGRES_URL is not set for e2e");
			const sql = postgres(DATABASE_URL, { max: 2 });
			await use(sql);
			await sql.end();
		},
		{ scope: "worker" },
	],
	account: [
		async ({ sql }, use, workerInfo) => {
			// Accounts come from global-setup.ts, one per parallel slot, so a
			// worker restarted after a failure reuses its slot's account.
			const pool: Account[] = fs.existsSync(ACCOUNTS_FILE)
				? JSON.parse(fs.readFileSync(ACCOUNTS_FILE, "utf8"))
				: [];
			const account =
				pool[workerInfo.parallelIndex] ??
				(await createAccount(sql, workerInfo.workerIndex));
			await use(account);
		},
		{ scope: "worker" },
	],
	storageState: async ({ account }, use) => {
		await use(account.storageState);
	},
	seed: [
		async ({ page, sql, account }, use) => {
			await sql`delete from feeds where user_id = ${account.userId}`;
			await use(new Seeder(page.request, sql, account.userId));
		},
		{ auto: true },
	],
});

// ── Page helpers ───────────────────────────────────────────────────────────

/** The post list in the middle pane. */
export function rows(page: Page) {
	return page.getByRole("list", { name: "Posts" }).getByRole("listitem");
}

export function row(page: Page, title: string) {
	return rows(page).filter({ hasText: title });
}

/** The unread dot at the left of a row. */
export function unreadDot(page: Page, title: string) {
	return row(page, title).locator(".bg-unread");
}

export function sidebar(page: Page) {
	return page.getByRole("navigation");
}

export function sidebarLink(page: Page, name: string | RegExp) {
	return sidebar(page).getByRole("link", { name });
}

/** The reading pane's title. */
export function detailTitle(page: Page) {
	return page.getByRole("heading", { level: 1 });
}

export function toast(page: Page, text: string | RegExp) {
	return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** The app's main region — keeps locators clear of the dev-only devtools DOM. */
export function main(page: Page) {
	return page.getByRole("main");
}

/**
 * Opens the reader and waits until the list has settled (the skeleton is
 * server-rendered, so its disappearance also means React has hydrated and
 * the first fetch has finished).
 */
export async function openReader(page: Page, view?: string) {
	await page.goto(
		view ? `/reader?view=${encodeURIComponent(view)}` : "/reader",
	);
	await expect(page.getByPlaceholder("Search")).toBeVisible();
	await expect(main(page).locator(".animate-pulse")).toHaveCount(0);
}

export async function openSettings(page: Page) {
	await page.goto("/settings");
	await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
	await expect(main(page).getByText("Loading…")).toHaveCount(0);
}
