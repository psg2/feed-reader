import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { getTestDb } from "@/tests/setup";
import { discoverFeeds, parseFeed } from "@/server/lib/feedfetch";
import * as reader from "./reader";

// Test hosts don't exist; the SSRF guard resolves them to a public address.
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const fixture = (name: string) =>
	readFileSync(join(__dirname, "../../tests/fixtures", name), "utf8");

/** fetch stub serving canned bodies by URL; anything else 404s. */
function stubFetch(routes: Record<string, string>): typeof fetch {
	return async (input) => {
		const url = String(input);
		const body = routes[url];
		return new Response(body ?? "not found", {
			status: body === undefined ? 404 : 200,
		});
	};
}

async function createTestUser(db: ReturnType<typeof getTestDb>) {
	const { users } = await import("@feedreader/db/schema");
	const [user] = await db
		.insert(users)
		.values({
			name: "T",
			email: `t-${crypto.randomUUID()}@x.com`,
			emailVerified: false,
		})
		.returning();
	return user;
}

describe("feedfetch", () => {
	it("parses a real Atom fixture", async () => {
		const parsed = await parseFeed(fixture("simonwillison.xml"));
		expect(parsed.title).toContain("Simon Willison");
		expect(parsed.entries.length).toBeGreaterThan(5);
		const e = parsed.entries[0];
		expect(e.guid).toBeTruthy();
		expect(e.publishedAt).toBeInstanceOf(Date);
		expect(e.contentText).not.toMatch(/</);
	});

	it("discovers feeds from HTML link tags and conventional paths", async () => {
		const html = `<html><head>
			<link rel="alternate" type="application/atom+xml" href="/atom/everything/">
		</head></html>`;
		const f = stubFetch({
			"https://site.test/": html,
			"https://site.test/atom/everything/": fixture("simonwillison.xml"),
		});
		expect(await discoverFeeds("https://site.test/", f)).toEqual([
			"https://site.test/atom/everything/",
		]);

		const bare = stubFetch({
			"https://plain.test/": "<html><body>no links</body></html>",
			"https://plain.test/feed": fixture("lethain.xml"),
		});
		expect(await discoverFeeds("https://plain.test/", bare)).toEqual([
			"https://plain.test/feed",
		]);

		await expect(
			discoverFeeds(
				"https://nothing.test/",
				stubFetch({ "https://nothing.test/": "<html></html>" }),
			),
		).rejects.toThrow(/No feed found/);
	});
});

describe("reader usecases", () => {
	it("subscribe autodiscovers, stores entries and keeps 5 unread", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({
			"https://simonwillison.net/": `<link rel="alternate" type="application/atom+xml" href="https://simonwillison.net/atom/everything/">`,
			"https://simonwillison.net/atom/everything/":
				fixture("simonwillison.xml"),
		});
		const feed = await reader.subscribe(
			db,
			user.id,
			{ url: "https://simonwillison.net/" },
			f,
		);
		expect(feed.title).toContain("Simon Willison");
		expect(feed.unread).toBe(5);

		await expect(
			reader.subscribe(
				db,
				user.id,
				{ url: "https://simonwillison.net/atom/everything/" },
				f,
			),
		).rejects.toThrow(/Already exists/);
	});

	it("refresh adds only new items and records per-feed errors", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({ "https://l.test/feed": fixture("lethain.xml") });
		await reader.subscribe(db, user.id, { url: "https://l.test/feed" }, f);

		// Subscribe just fetched: a manual refresh inside the cooldown is a no-op.
		expect(await reader.refresh(db, user.id, stubFetch({}))).toEqual({
			feedsChecked: 0,
			feedsFailed: 0,
			newItems: 0,
		});
		const [feed] = await reader.listFeeds(db, user.id);
		const feedRepo = await import("@/server/repos/feeds");
		const backdate = () =>
			feedRepo.updateFeed(db, user.id, feed.id, {
				lastFetchedAt: new Date(Date.now() - 120_000),
			});

		await backdate();
		const again = await reader.refresh(db, user.id, f);
		expect(again).toMatchObject({
			feedsChecked: 1,
			feedsFailed: 0,
			newItems: 0,
		});

		await backdate();
		const broken = await reader.refresh(db, user.id, stubFetch({}));
		expect(broken).toMatchObject({ feedsChecked: 1, feedsFailed: 1 });
		const feeds = await reader.listFeeds(db, user.id);
		expect(feeds[0].lastError).toMatch(/HTTP 404/);
	});

	it("records only safe messages as lastError", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({ "https://l.test/feed": fixture("lethain.xml") });
		const feed = await reader.subscribe(
			db,
			user.id,
			{ url: "https://l.test/feed" },
			f,
		);
		const summary = await reader.refreshFeeds(
			db,
			[{ ...feed, userId: user.id }],
			async () => {
				throw new Error("ECONNREFUSED 10.1.2.3:5432 internal detail");
			},
			{ force: true },
		);
		expect(summary.feedsFailed).toBe(1);
		const [after] = await reader.listFeeds(db, user.id);
		expect(after.lastError).toBe("Couldn't reach https://l.test/feed");
	});

	it("subscribe rejects the same URL twice, even concurrently", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({ "https://l.test/feed": fixture("lethain.xml") });
		const results = await Promise.allSettled([
			reader.subscribe(db, user.id, { url: "https://l.test/feed" }, f),
			reader.subscribe(db, user.id, { url: "https://l.test/feed" }, f),
		]);
		expect(results.map((r) => r.status).sort()).toEqual([
			"fulfilled",
			"rejected",
		]);
		expect(await reader.listFeeds(db, user.id)).toHaveLength(1);
	});

	it("updateItem round-trips read/star/notes/tags", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({ "https://l.test/feed": fixture("lethain.xml") });
		await reader.subscribe(db, user.id, { url: "https://l.test/feed" }, f);
		const [first] = await reader.listItems(db, user.id, {
			filter: { kind: "unread" },
			search: "",
			limit: 1,
		});
		const updated = await reader.updateItem(db, user.id, first.id, {
			read: true,
			starred: true,
			notes: "learned",
			tags: ["Eng", "eng "],
		});
		expect(updated?.readAt).not.toBeNull();
		expect(updated?.starred).toBe(true);
		const detail = await reader.getItem(db, user.id, first.id);
		expect(detail?.notes).toBe("learned");
		expect(detail?.tags).toEqual(["eng"]);
	});

	it("syncDump returns the full mirror with ISO dates, tags and scoping", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const other = await createTestUser(db);
		const f = stubFetch({
			"https://l.test/feed": fixture("lethain.xml"),
			"https://s.test/feed": fixture("simonwillison.xml"),
		});
		await reader.subscribe(db, user.id, { url: "https://l.test/feed" }, f);
		await reader.subscribe(db, other.id, { url: "https://s.test/feed" }, f);
		const [first] = await reader.listItems(db, user.id, {
			filter: { kind: "all" },
			search: "",
			limit: 1,
		});
		await reader.updateItem(db, user.id, first.id, {
			read: true,
			notes: "n",
			tags: ["sync"],
		});

		const dump = await reader.syncDump(db, user.id);
		expect(dump.feeds).toHaveLength(1);
		expect(dump.feeds[0].url).toBe("https://l.test/feed");
		expect(dump.items.length).toBeGreaterThan(5);
		// only the user's own feeds/items
		expect(new Set(dump.items.map((i) => i.feedId))).toEqual(
			new Set([dump.feeds[0].id]),
		);
		const marked = dump.items.find((i) => i.id === first.id);
		expect(marked?.readAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(marked?.notes).toBe("n");
		expect(marked?.tags).toEqual(["sync"]);
		expect(marked?.contentHtml).toBeTruthy();
		const published = dump.items.find((i) => i.publishedAt !== null);
		expect(published?.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
	});
});

describe("cron refresh", () => {
	it("sweeps enabled feeds across users and skips disabled ones", async () => {
		const db = getTestDb();
		const a = await createTestUser(db);
		const b = await createTestUser(db);
		const f = stubFetch({
			"https://a.test/feed": fixture("lethain.xml"),
			"https://b.test/feed": fixture("simonwillison.xml"),
		});
		await reader.subscribe(db, a.id, { url: "https://a.test/feed" }, f);
		const feedB = await reader.subscribe(
			db,
			b.id,
			{ url: "https://b.test/feed" },
			f,
		);
		await reader.updateFeed(db, b.id, feedB.id, { enabled: false });

		// Feed A was fetched seconds ago by subscribe: not stale, so skipped.
		const fetchedAt = (await reader.listFeeds(db, a.id))[0].lastFetchedAt;
		await reader.refreshAllUsers(db, f);
		expect((await reader.listFeeds(db, a.id))[0].lastFetchedAt).toEqual(
			fetchedAt,
		);

		const summary = await reader.refreshAllUsers(db, f, { force: true });
		expect(summary.feedsFailed).toBe(0);
		expect(summary.feedsChecked).toBeGreaterThanOrEqual(1);
		expect((await reader.listFeeds(db, a.id))[0].lastFetchedAt).not.toEqual(
			fetchedAt,
		);
		const urls = (await reader.listFeeds(db, b.id)).filter((x) => x.enabled);
		expect(urls).toHaveLength(0);
	});

	it("fetches at most six feeds at a time", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const { createFeed } = await import("@/server/repos/feeds");
		const feeds = await Promise.all(
			Array.from({ length: 10 }, (_, i) =>
				createFeed(db, {
					userId: user.id,
					title: `F${i}`,
					url: `https://pool.test/${i}`,
				}),
			),
		);
		let inFlight = 0;
		let peak = 0;
		const summary = await reader.refreshFeeds(
			db,
			feeds.map((f) => f!),
			async () => {
				inFlight += 1;
				peak = Math.max(peak, inFlight);
				await new Promise((r) => setTimeout(r, 10));
				inFlight -= 1;
				return new Response(fixture("lethain.xml"));
			},
		);
		expect(summary.feedsChecked).toBe(10);
		expect(peak).toBeLessThanOrEqual(6);
		expect(peak).toBeGreaterThan(1);
	});
});

describe("refreshFeeds", () => {
	it("never fetches newsletter feeds", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const { createFeed, getFeedByUrl } = await import("@/server/repos/feeds");
		const feed = await createFeed(db, {
			userId: user.id,
			title: "N",
			url: "mailto:a@b.test",
		});
		let calls = 0;
		const summary = await reader.refreshFeeds(db, [feed], async () => {
			calls += 1;
			return new Response("nope", { status: 500 });
		});
		expect(calls).toBe(0);
		expect(summary).toEqual({ feedsChecked: 0, feedsFailed: 0, newItems: 0 });
		expect(
			(await getFeedByUrl(db, user.id, "mailto:a@b.test"))?.lastError,
		).toBeNull();
	});
});
