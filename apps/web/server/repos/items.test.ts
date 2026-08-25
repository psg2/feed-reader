import { describe, expect, it } from "vitest";
import { getTestDb } from "@/tests/setup";
import * as feedRepo from "./feeds";
import * as itemRepo from "./items";

async function seed(db: ReturnType<typeof getTestDb>) {
	const { users } = await import("@feedreader/db/schema");
	const [user] = await db
		.insert(users)
		.values({
			name: "T",
			email: `t-${crypto.randomUUID()}@x.com`,
			emailVerified: false,
		})
		.returning();
	const feed = await feedRepo.createFeed(db, {
		userId: user.id,
		title: "Blog",
		url: `https://blog.test/${crypto.randomUUID()}/feed`,
	});
	const base = Date.parse("2026-01-10T12:00:00Z");
	await itemRepo.storeEntries(
		db,
		feed.id,
		["Newest", "Middle", "Oldest"].map((title, i) => ({
			guid: `g${i}`,
			title,
			link: `https://blog.test/${i}`,
			publishedAt: new Date(base - i * 3_600_000),
			contentHtml: `<p>${title}</p>`,
			contentText: title,
		})),
		{ markExistingAsRead: false },
	);
	const rows = await itemRepo.listItems(db, user.id, { kind: "all" });
	return { user, feed, rows };
}

describe("itemRepo", () => {
	it("lists with filters, search and feed scoping", async () => {
		const db = getTestDb();
		const { user, feed, rows } = await seed(db);
		expect(rows.map((r) => r.item.title)).toEqual([
			"Newest",
			"Middle",
			"Oldest",
		]);

		await itemRepo.markRead(db, user.id, [rows[2].item.id], true);
		const unread = await itemRepo.listItems(db, user.id, { kind: "unread" });
		expect(unread.map((r) => r.item.title)).toEqual(["Newest", "Middle"]);

		const found = await itemRepo.listItems(db, user.id, { kind: "all" }, "old");
		expect(found.map((r) => r.item.title)).toEqual(["Oldest"]);
		// ILIKE metacharacters are matched literally, not as wildcards.
		await itemRepo.setNotes(db, user.id, rows[1].item.id, "100% done_");
		const percent = await itemRepo.listItems(db, user.id, { kind: "all" }, "%");
		expect(percent.map((r) => r.item.title)).toEqual(["Middle"]);
		const under = await itemRepo.listItems(db, user.id, { kind: "all" }, "e_");
		expect(under.map((r) => r.item.title)).toEqual(["Middle"]);

		const byFeed = await itemRepo.listItems(db, user.id, {
			kind: "feed",
			feedId: feed.id,
		});
		expect(byFeed).toHaveLength(3);

		await itemRepo.setTags(db, user.id, rows[0].item.id, [
			" Swift ",
			"LLM",
			"swift",
		]);
		const byTag = await itemRepo.listItems(db, user.id, {
			kind: "tag",
			tag: "swift",
		});
		expect(byTag.map((r) => r.item.id)).toEqual([rows[0].item.id]);
	});

	it("scopes reads and writes to the owner", async () => {
		const db = getTestDb();
		const a = await seed(db);
		const b = await seed(db);
		expect(
			await itemRepo.listItems(db, a.user.id, { kind: "all" }),
		).toHaveLength(3);
		expect(await itemRepo.getItem(db, b.user.id, a.rows[0].item.id)).toBeNull();
		expect(
			await itemRepo.markRead(db, b.user.id, [a.rows[0].item.id], true),
		).toEqual([]);
		expect(
			await itemRepo.setStarred(db, b.user.id, a.rows[0].item.id, true),
		).toBeNull();
	});

	it("getItem returns tags; markAllRead returns ids for undo", async () => {
		const db = getTestDb();
		const { user, rows } = await seed(db);
		await itemRepo.setTags(db, user.id, rows[0].item.id, ["swift"]);
		const detail = await itemRepo.getItem(db, user.id, rows[0].item.id);
		expect(detail?.tags).toEqual(["swift"]);

		const ids = await itemRepo.markAllRead(db, user.id);
		expect(ids.sort()).toEqual(rows.map((r) => r.item.id).sort());
		expect(
			await itemRepo.listItems(db, user.id, { kind: "unread" }),
		).toHaveLength(0);
		await itemRepo.markRead(db, user.id, ids, false);
		expect(
			await itemRepo.listItems(db, user.id, { kind: "unread" }),
		).toHaveLength(3);
	});

	it("storeEntries dedups by guid and keeps only N unread on backfill", async () => {
		const db = getTestDb();
		const { user, feed } = await seed(db);
		const again = await itemRepo.storeEntries(
			db,
			feed.id,
			[{ guid: "g0", title: "Newest again" }],
			{ markExistingAsRead: false },
		);
		expect(again).toBe(0);

		const feed2 = await feedRepo.createFeed(db, {
			userId: user.id,
			title: "Backfill",
			url: `https://b.test/${crypto.randomUUID()}`,
		});
		const n = await itemRepo.storeEntries(
			db,
			feed2.id,
			Array.from({ length: 8 }, (_, i) => ({ guid: `b${i}`, title: `P${i}` })),
			{ markExistingAsRead: true, keepUnread: 5 },
		);
		expect(n).toBe(8);
		const unread = await itemRepo.listItems(db, user.id, {
			kind: "feed",
			feedId: feed2.id,
		});
		expect(unread.filter((r) => r.item.readAt === null)).toHaveLength(5);
	});

	it("feed list carries unread counts; tags aggregate per user", async () => {
		const db = getTestDb();
		const { user, rows } = await seed(db);
		await itemRepo.markRead(db, user.id, [rows[0].item.id], true);
		const feedsList = await feedRepo.listFeeds(db, user.id);
		expect(feedsList).toHaveLength(1);
		expect(feedsList[0].unread).toBe(2);
		await itemRepo.setTags(db, user.id, rows[0].item.id, ["b", "a"]);
		expect(await itemRepo.listAllTags(db, user.id)).toEqual(["a", "b"]);
	});
});
