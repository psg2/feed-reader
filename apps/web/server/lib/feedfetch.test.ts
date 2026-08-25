import { lookup } from "node:dns/promises";
import { describe, expect, it, vi } from "vitest";
import { FeedError, parseFeed, safeFetch } from "./feedfetch";

vi.mock("node:dns/promises", () => ({
	lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]),
}));

/** fetch stub: a handler per URL; missing URLs 404. */
function stubFetch(
	routes: Record<string, () => Response>,
): typeof fetch & { calls: string[] } {
	const calls: string[] = [];
	const f = async (input: RequestInfo | URL) => {
		const url = String(input);
		calls.push(url);
		return routes[url]?.() ?? new Response("not found", { status: 404 });
	};
	return Object.assign(f, { calls });
}

const redirect = (to: string) =>
	new Response(null, { status: 302, headers: { location: to } });

const failingFetch: typeof fetch = async () => {
	throw new Error("connect ECONNREFUSED 10.0.0.1:443 secret-internal-host");
};

const rss = (items: string) =>
	`<rss version="2.0"><channel><title>T</title>${items}</channel></rss>`;

describe("safeFetch", () => {
	it("only speaks http(s) and refuses credentials in the URL", async () => {
		const f = stubFetch({});
		for (const url of [
			"file:///etc/passwd",
			"ftp://example.com/feed",
			"gopher://example.com",
			"https://user:pw@example.com/feed",
			"not a url",
		]) {
			await expect(safeFetch(url, f)).rejects.toBeInstanceOf(FeedError);
		}
		expect(f.calls).toEqual([]);
	});

	it("refuses loopback, private, link-local, metadata and mapped addresses", async () => {
		const f = stubFetch({});
		for (const host of [
			"localhost",
			"app.localhost",
			"127.0.0.1",
			"127.9.9.9",
			"0.0.0.0",
			"10.0.0.5",
			"172.16.0.1",
			"172.31.255.255",
			"192.168.1.1",
			"169.254.169.254",
			"100.64.0.1",
			"[::1]",
			"[::]",
			"[fc00::1]",
			"[fd12::1]",
			"[fe80::1]",
			"[::ffff:127.0.0.1]",
			"[::ffff:10.0.0.1]",
			"[64:ff9b::a00:1]",
		]) {
			await expect(safeFetch(`http://${host}/feed`, f), host).rejects.toThrow(
				/local|private/,
			);
		}
		expect(f.calls).toEqual([]);
	});

	it("rejects hostnames that resolve to private addresses", async () => {
		vi.mocked(lookup).mockResolvedValueOnce([
			{ address: "93.184.216.34", family: 4 },
			{ address: "10.0.0.1", family: 4 },
		] as never);
		const f = stubFetch({});
		await expect(safeFetch("https://rebind.test/feed", f)).rejects.toThrow(
			/private address/,
		);
		vi.mocked(lookup).mockRejectedValueOnce(new Error("ENOTFOUND"));
		await expect(safeFetch("https://nope.test/feed", f)).rejects.toThrow(
			/Couldn't resolve/,
		);
		expect(f.calls).toEqual([]);
	});

	it("follows redirects hop by hop, re-checking every target", async () => {
		const f = stubFetch({
			"https://a.test/": () => redirect("/feed"),
			"https://a.test/feed": () => redirect("https://b.test/feed"),
			"https://b.test/feed": () => new Response("<rss/>"),
			"https://evil.test/": () => redirect("http://169.254.169.254/latest"),
		});
		await expect(safeFetch("https://a.test/", f)).resolves.toEqual({
			url: "https://b.test/feed",
			text: "<rss/>",
		});
		await expect(safeFetch("https://evil.test/", f)).rejects.toThrow(
			/private address/,
		);
		expect(f.calls).not.toContain("http://169.254.169.254/latest");
	});

	it("gives up after five redirects", async () => {
		const f = stubFetch({
			"https://loop.test/": () => redirect("https://loop.test/"),
		});
		await expect(safeFetch("https://loop.test/", f)).rejects.toThrow(
			/Too many redirects/,
		);
		expect(f.calls).toHaveLength(6);
	});

	it("caps the body at 5 MB, by header and by bytes actually read", async () => {
		const f = stubFetch({
			"https://big.test/declared": () =>
				new Response("x", { headers: { "content-length": "6000000" } }),
			"https://big.test/streamed": () => {
				const chunk = new Uint8Array(1024 * 1024);
				let sent = 0;
				return new Response(
					new ReadableStream({
						pull(controller) {
							if (sent++ < 8) controller.enqueue(chunk);
							else controller.close();
						},
					}),
				);
			},
		});
		await expect(safeFetch("https://big.test/declared", f)).rejects.toThrow(
			/too large/,
		);
		await expect(safeFetch("https://big.test/streamed", f)).rejects.toThrow(
			/too large/,
		);
	});

	it("turns transport failures into FeedErrors without the raw reason", async () => {
		const err = await safeFetch("https://down.test/", failingFetch).catch(
			(e) => e,
		);
		expect(err).toBeInstanceOf(FeedError);
		expect(err.message).toBe("Couldn't reach https://down.test/");
	});
});

describe("parseFeed", () => {
	it("derives a stable guid when the entry has no guid or link", async () => {
		const xml = rss(
			`<item><title>Hello</title><pubDate>Mon, 06 Sep 2021 10:00:00 GMT</pubDate></item>`,
		);
		const a = await parseFeed(xml);
		const b = await parseFeed(xml);
		expect(a.entries[0].guid).toMatch(/^[0-9a-f]{64}$/);
		expect(a.entries[0].guid).toBe(b.entries[0].guid);
		const other = await parseFeed(rss(`<item><title>Other</title></item>`));
		expect(other.entries[0].guid).not.toBe(a.entries[0].guid);
	});

	it("drops invalid dates and clamps dates far in the future", async () => {
		const parsed = await parseFeed(
			rss(
				`<item><guid>1</guid><title>Bad</title><pubDate>not a date</pubDate></item>` +
					`<item><guid>2</guid><title>Future</title><pubDate>Fri, 01 Jan 2100 00:00:00 GMT</pubDate></item>` +
					`<item><guid>3</guid><title>Past</title><pubDate>Mon, 06 Sep 2021 10:00:00 GMT</pubDate></item>`,
			),
		);
		const [bad, future, past] = parsed.entries;
		expect(bad.publishedAt).toBeNull();
		expect(future.publishedAt!.getTime()).toBeLessThanOrEqual(Date.now());
		expect(past.publishedAt?.toISOString()).toBe("2021-09-06T10:00:00.000Z");
	});
});
