import { describe, expect, it } from "vitest";
import { getTestDb } from "@/tests/setup";
import * as feedRepo from "@/server/repos/feeds";
import * as itemRepo from "@/server/repos/items";
import {
	NEWSLETTER_CATEGORY,
	decodeBody,
	embedAttachments,
	fetchAttachment,
	fetchReceivedEmail,
	findViewInBrowserLink,
	ingestReceivedEmail,
	isSenderAllowed,
	parseAddress,
	parseAllowedSenders,
	type ReceivedEmail,
} from "./inbound";

async function createTestUser(db: ReturnType<typeof getTestDb>, email: string) {
	const { users } = await import("@feedreader/db/schema");
	const [user] = await db
		.insert(users)
		.values({ name: "T", email, emailVerified: false })
		.returning();
	return user;
}

const email = (over: Partial<ReceivedEmail> = {}): ReceivedEmail => ({
	id: "re_1",
	from: "hello@newsletter.example",
	to: ["simon@news.example.test"],
	subject: "Weekly notes",
	html: "<p>Hello <b>world</b></p>",
	text: null,
	headers: { from: "Simon's Newsletter <hello@newsletter.example>" },
	message_id: "<abc@newsletter.example>",
	created_at: "2026-08-24T12:00:00.000Z",
	...over,
});

describe("inbound e-mail", () => {
	it("parses addresses and data: bodies", () => {
		expect(parseAddress("Simon <Hello@X.com>")).toEqual({
			name: "Simon",
			address: "hello@x.com",
		});
		expect(parseAddress("hello@x.com")).toEqual({
			name: null,
			address: "hello@x.com",
		});
		expect(
			decodeBody(
				`data:text/html;base64,${Buffer.from("<i>hi</i>").toString("base64")}`,
			),
		).toBe("<i>hi</i>");
		expect(decodeBody("data:text/plain,a%20b")).toBe("a b");
		expect(decodeBody("<p>x</p>")).toBe("<p>x</p>");
	});

	it("creates a feed per sender for the first user and dedups by message id", async () => {
		const db = getTestDb();
		const owner = await createTestUser(
			db,
			`owner-${crypto.randomUUID()}@x.com`,
		);
		await createTestUser(db, `second-${crypto.randomUUID()}@x.com`);

		const first = await ingestReceivedEmail(db, email(), {
			inboundDomain: "news.example.test",
		});
		expect(first.status).toBe("stored");
		const feed = await feedRepo.getFeedByUrl(
			db,
			owner.id,
			"mailto:hello@newsletter.example",
		);
		expect(feed?.title).toBe("Simon's Newsletter");
		expect(feed?.category).toBe(NEWSLETTER_CATEGORY);

		const items = await itemRepo.listItems(db, owner.id, { kind: "unread" });
		expect(items).toHaveLength(1);
		expect(items[0].item.title).toBe("Weekly notes");
		expect(items[0].item.contentText).toBe("Hello world");
		expect(items[0].item.author).toBe("Simon's Newsletter");

		const again = await ingestReceivedEmail(db, email({ id: "re_2" }), {
			inboundDomain: "news.example.test",
		});
		expect(again.status).toBe("duplicate");
		expect(again.feedId).toBe(feed?.id);

		const other = await ingestReceivedEmail(
			db,
			email({ id: "re_3", to: ["me@elsewhere.test"] }),
			{
				inboundDomain: "news.example.test",
			},
		);
		expect(other.status).toBe("ignored");
	});

	it("falls back to text bodies and the resend id", async () => {
		const db = getTestDb();
		const owner = await createTestUser(
			db,
			`owner-${crypto.randomUUID()}@x.com`,
		);
		const r = await ingestReceivedEmail(
			db,
			email({
				html: null,
				text: "plain <text>",
				message_id: null,
				subject: null,
			}),
		);
		expect(r.status).toBe("stored");
		const items = await itemRepo.listItems(db, owner.id, { kind: "all" });
		expect(items[0].item.guid).toBe("resend:re_1");
		expect(items[0].item.title).toBe("(no subject)");
		expect(items[0].item.contentHtml).toBe("<pre>plain &lt;text&gt;</pre>");
	});

	it("matches senders against the allowlist", () => {
		const allowed = parseAllowedSenders(" Hello@News.com, @Substack.com ,, ");
		expect(allowed).toEqual(["hello@news.com", "@substack.com"]);
		expect(isSenderAllowed("HELLO@news.com", allowed)).toBe(true);
		expect(isSenderAllowed("x@substack.com", allowed)).toBe(true);
		expect(isSenderAllowed("x@notsubstack.com", allowed)).toBe(false);
		expect(isSenderAllowed("other@news.com", allowed)).toBe(false);
		expect(isSenderAllowed("anyone@x.com", [])).toBe(true);
		expect(
			isSenderAllowed("anyone@x.com", parseAllowedSenders(undefined)),
		).toBe(true);
	});

	it("ignores senders outside the allowlist", async () => {
		const db = getTestDb();
		await createTestUser(db, `owner-${crypto.randomUUID()}@x.com`);
		const r = await ingestReceivedEmail(db, email(), {
			allowedSenders: ["@other.example"],
		});
		expect(r).toEqual({ status: "ignored", reason: "sender" });
		const ok = await ingestReceivedEmail(db, email(), {
			allowedSenders: ["@newsletter.example"],
		});
		expect(ok.status).toBe("stored");
	});

	it("finds the view-in-browser link", () => {
		expect(
			findViewInBrowserLink(
				'<p><a href="https://x.com/unsub">Unsubscribe</a> · <a href="https://x.com/p/1?a=1&amp;b=2" style="color:red"><span>View in your browser</span></a></p>',
			),
		).toBe("https://x.com/p/1?a=1&b=2");
		expect(
			findViewInBrowserLink("<a href='https://x.com/p/2'>Ver no navegador</a>"),
		).toBe("https://x.com/p/2");
		expect(
			findViewInBrowserLink('<a href="mailto:a@b.c">View online</a>'),
		).toBeNull();
		expect(findViewInBrowserLink("<p>no links</p>")).toBeNull();
	});

	it("stores the view-in-browser link on the item", async () => {
		const db = getTestDb();
		const owner = await createTestUser(
			db,
			`owner-${crypto.randomUUID()}@x.com`,
		);
		await ingestReceivedEmail(
			db,
			email({
				html: '<a href="https://n.example/issue/1">Read online</a><p>Hi</p>',
			}),
		);
		const items = await itemRepo.listItems(db, owner.id, { kind: "all" });
		expect(items[0].item.link).toBe("https://n.example/issue/1");
	});

	it("inlines cid images and lists other attachments", async () => {
		const png = new Uint8Array([1, 2, 3]);
		const downloaded: string[] = [];
		const out = await embedAttachments(
			'<img src="cid:logo@x"><img src="cid:missing@x">',
			{
				id: "re_1",
				attachments: [
					{
						id: "att_logo",
						filename: "logo.png",
						content_type: "image/png",
						content_disposition: "inline",
						content_id: "<logo@x>",
						size: 3,
					},
					{
						id: "att_big",
						filename: "big.png",
						content_type: "image/png",
						content_disposition: "inline",
						content_id: "<missing@x>",
						size: 5 * 1024 * 1024,
					},
					{
						id: "att_pdf",
						filename: "report <q>.pdf",
						content_type: "application/pdf",
						content_disposition: "attachment",
						content_id: null,
						size: 2048,
					},
				],
			},
			async (id) => {
				downloaded.push(id);
				return png;
			},
		);
		expect(downloaded).toEqual(["att_logo"]);
		expect(out).toContain('<img src="data:image/png;base64,AQID">');
		expect(out).toContain('<img src="cid:missing@x">');
		expect(out).toContain("big.png <small>(5.0 MB)</small>");
		expect(out).toContain("report &lt;q&gt;.pdf <small>(2 KB)</small>");
		expect(out).toContain('<ul class="attachments">');
	});

	it("keeps cid references when a download fails", async () => {
		const out = await embedAttachments(
			'<img src="cid:a@x">',
			{
				id: "re_1",
				attachments: [
					{
						id: "att_a",
						filename: "a.png",
						content_type: "image/png",
						content_disposition: "inline",
						content_id: "a@x",
						size: 10,
					},
				],
			},
			async () => {
				throw new Error("boom");
			},
		);
		expect(out).toContain('<img src="cid:a@x">');
		expect(out).toContain("a.png");
	});

	it("downloads attachments through the short-lived URL", async () => {
		const calls: string[] = [];
		const stub: typeof fetch = async (input, init) => {
			const url = String(input);
			const headers = (init?.headers ?? {}) as Record<string, string>;
			calls.push(`${url} ${headers.authorization ?? "-"}`);
			if (url.includes("/attachments/"))
				return Response.json({
					download_url: "https://files.example/x",
					expires_at: "2026-08-24T13:00:00.000Z",
				});
			return new Response(new Uint8Array([9, 8]));
		};
		const bytes = await fetchAttachment("re_key", "re_1", "att_1", stub);
		expect(Array.from(bytes)).toEqual([9, 8]);
		expect(calls).toEqual([
			"https://api.resend.com/emails/receiving/re_1/attachments/att_1 Bearer re_key",
			"https://files.example/x -",
		]);
	});

	it("fetches the body from the Received Emails API", async () => {
		const calls: string[] = [];
		const stub: typeof fetch = async (input, init) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			calls.push(`${String(input)} ${headers.authorization}`);
			return Response.json(email());
		};
		const got = await fetchReceivedEmail("re_key", "re_1", stub);
		expect(got.subject).toBe("Weekly notes");
		expect(calls).toEqual([
			"https://api.resend.com/emails/receiving/re_1 Bearer re_key",
		]);
	});
});
