import { readFileSync } from "node:fs";
import { join } from "node:path";
import { users } from "@feedreader/db/schema";
import { describe, expect, it, vi } from "vitest";
import { getTestDb } from "@/tests/setup";
import { buildOpml, parseOpml } from "@/server/lib/opml";
import * as reader from "./reader";

// Test hosts don't exist; the SSRF guard resolves them to a public address.
vi.mock("node:dns/promises", () => ({
	lookup: async () => [{ address: "93.184.216.34", family: 4 }],
}));

const fixture = (name: string) =>
	readFileSync(join(__dirname, "../../tests/fixtures", name), "utf8");

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

describe("opml", () => {
	it("parses nested outlines and keeps the folder as category", () => {
		const outlines = parseOpml(fixture("sample.opml"));
		expect(outlines).toEqual([
			{
				xmlUrl: "https://simonwillison.net/atom/everything/",
				title: "Simon Willison",
				htmlUrl: "https://simonwillison.net/",
				category: null,
			},
			{
				xmlUrl: "https://lethain.com/feeds/",
				title: "Irrational Exuberance",
				htmlUrl: "https://lethain.com/",
				category: "Engineering",
			},
			{
				xmlUrl: "https://broken.example/feed.xml",
				title: "Broken",
				htmlUrl: null,
				category: "Engineering",
			},
		]);
	});

	it("builds an OPML 2.0 document grouped by category", () => {
		const xml = buildOpml([
			{
				title: "A & B",
				url: "https://a.test/feed",
				siteUrl: "https://a.test",
				category: null,
			},
			{
				title: "C",
				url: "https://c.test/feed",
				siteUrl: null,
				category: "Work",
			},
		]);
		expect(xml).toContain('<opml version="2.0">');
		expect(xml).toContain('text="A &amp; B"');
		expect(xml).toContain('htmlUrl="https://a.test"');
		expect(xml).toMatch(
			/<outline text="Work" title="Work">\s*<outline text="C"/,
		);
		expect(parseOpml(xml)).toEqual([
			{
				xmlUrl: "https://a.test/feed",
				title: "A & B",
				htmlUrl: "https://a.test",
				category: null,
			},
			{
				xmlUrl: "https://c.test/feed",
				title: "C",
				htmlUrl: null,
				category: "Work",
			},
		]);
	});

	it("importOpml subscribes, skips duplicates and tolerates failures", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({
			"https://simonwillison.net/atom/everything/":
				fixture("simonwillison.xml"),
			"https://lethain.com/feeds/": fixture("lethain.xml"),
		});
		await reader.subscribe(
			db,
			user.id,
			{ url: "https://lethain.com/feeds/" },
			f,
		);

		const result = await reader.importOpml(
			db,
			user.id,
			fixture("sample.opml"),
			f,
		);
		expect(result.added).toBe(1);
		expect(result.skipped).toBe(1);
		expect(result.failed).toHaveLength(1);
		expect(result.failed[0].url).toBe("https://broken.example/feed.xml");

		const feeds = await reader.listFeeds(db, user.id);
		expect(feeds.map((x) => x.url).sort()).toEqual([
			"https://lethain.com/feeds/",
			"https://simonwillison.net/atom/everything/",
		]);

		const xml = await reader.exportOpml(db, user.id);
		expect(
			parseOpml(xml)
				.map((o) => o.xmlUrl)
				.sort(),
		).toEqual([
			"https://lethain.com/feeds/",
			"https://simonwillison.net/atom/everything/",
		]);
	});

	it("importOpml refuses more than 500 outlines", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const outlines = Array.from(
			{ length: 501 },
			(_, i) => `<outline type="rss" xmlUrl="https://many.test/${i}"/>`,
		).join("");
		await expect(
			reader.importOpml(
				db,
				user.id,
				`<opml version="2.0"><body>${outlines}</body></opml>`,
				stubFetch({}),
			),
		).rejects.toThrow(/limit is 500/);
	});

	it("markAllRead honours the view filter", async () => {
		const db = getTestDb();
		const user = await createTestUser(db);
		const f = stubFetch({
			"https://simonwillison.net/atom/everything/":
				fixture("simonwillison.xml"),
			"https://lethain.com/feeds/": fixture("lethain.xml"),
		});
		const a = await reader.subscribe(
			db,
			user.id,
			{ url: "https://lethain.com/feeds/" },
			f,
		);
		await reader.subscribe(
			db,
			user.id,
			{ url: "https://simonwillison.net/atom/everything/" },
			f,
		);

		const unread = await reader.listItems(db, user.id, {
			filter: { kind: "unread" },
			search: "",
			limit: 50,
		});
		expect(unread).toHaveLength(10);
		await reader.updateItem(db, user.id, unread[0].id, { starred: true });

		const starred = await reader.markAllRead(db, user.id, {
			filter: { kind: "starred" },
		});
		expect(starred).toEqual([unread[0].id]);

		const inFeed = await reader.markAllRead(db, user.id, { feedId: a.id });
		expect(inFeed.length).toBe(
			unread.filter((i) => i.feedId === a.id && i.id !== unread[0].id).length,
		);

		const rest = await reader.markAllRead(db, user.id);
		expect(rest.length + inFeed.length + starred.length).toBe(10);
	});
});
