import { FEEDS } from "./env";
import {
	expect,
	main,
	openReader,
	openSettings,
	test,
	toast,
} from "./fixtures";

test.describe("Adding feeds", () => {
	test("an invalid URL, an unreachable feed and a duplicate each explain themselves", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await openReader(page);
		await page.getByRole("button", { name: "Add feed" }).first().click();
		const url = page.getByPlaceholder("Feed or site URL");
		const add = page.getByRole("button", { name: "Add", exact: true });

		await url.fill("not a url");
		await add.click();
		await expect(toast(page, "Enter a valid URL")).toBeVisible();

		await url.fill(FEEDS.missing);
		await add.click();
		await expect(toast(page, /HTTP 404/)).toBeVisible();

		await url.fill(FEEDS.lethain);
		await add.click();
		await expect(toast(page, /Already (exists|subscribed)/)).toBeVisible();
	});
});

test.describe("Settings", () => {
	test("feeds can be paused and unsubscribed, exported and imported", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await seed.subscribe(FEEDS.simon);

		await openSettings(page);
		const feeds = main(page).getByRole("list").first();
		await expect(feeds.getByText("Irrational Exuberance")).toBeVisible();
		await expect(feeds.getByText("Simon Willison's Weblog")).toBeVisible();

		await page
			.getByRole("button", { name: "Pause Irrational Exuberance" })
			.click();
		await expect(feeds.getByText("paused")).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Resume Irrational Exuberance" }),
		).toBeVisible();

		const download = page.waitForEvent("download");
		await page.getByRole("link", { name: "Export OPML" }).click();
		const file = await (await download).createReadStream();
		let xml = "";
		for await (const chunk of file) xml += chunk;
		expect(xml).toContain("<opml");
		expect(xml).toContain(FEEDS.lethain);
		expect(xml).toContain(FEEDS.simon);

		await page
			.getByRole("button", { name: "Unsubscribe from Simon Willison's Weblog" })
			.click();
		await expect(page.getByText("Unsubscribe?")).toBeVisible();
		await page.getByRole("button", { name: "Yes" }).click();
		await expect(toast(page, "Unsubscribed")).toBeVisible();
		await expect(feeds.getByText("Simon Willison's Weblog")).toBeHidden();

		const opml = `<?xml version="1.0" encoding="UTF-8"?>
<opml version="2.0"><head><title>e2e</title></head><body>
	<outline text="Simon" type="rss" xmlUrl="${FEEDS.simon}"/>
	<outline text="Engineering">
		<outline text="Copy" type="rss" xmlUrl="${FEEDS.lethainCopy}"/>
		<outline text="Already there" type="rss" xmlUrl="${FEEDS.lethain}"/>
	</outline>
</body></opml>`;
		await page.locator('input[type="file"]').setInputFiles({
			name: "subs.opml",
			mimeType: "text/x-opml",
			buffer: Buffer.from(opml),
		});
		await expect(toast(page, "OPML imported")).toBeVisible();
		await expect(toast(page, "2 added · 1 already subscribed")).toBeVisible();
		await expect(feeds.getByText("Simon Willison's Weblog")).toBeVisible();
		await expect(feeds.getByText("Irrational Exuberance")).toHaveCount(2);
	});

	test("newsletters explain Kill the Newsletter, show the inbound address when set, and the MCP snippet copies", async ({
		page,
	}) => {
		// Chromium's clipboard waits for window focus, which parallel workers
		// fight over; record what the page tries to copy instead.
		await page.addInitScript(() => {
			navigator.clipboard.writeText = async (text: string) => {
				(window as unknown as { __copied?: string }).__copied = text;
			};
		});
		await openSettings(page);

		const newsletters = page.getByRole("heading", { name: "Newsletters" });
		await expect(newsletters).toBeVisible();
		await expect(
			page.getByRole("link", { name: "kill-the-newsletter.com" }),
		).toBeVisible();
		const inboundAddress = page.getByText(
			`news@${process.env.INBOUND_EMAIL_DOMAIN ?? "unset.invalid"}`,
		);
		if (process.env.INBOUND_EMAIL_DOMAIN) {
			await expect(inboundAddress).toBeVisible();
		} else {
			await expect(inboundAddress).toBeHidden();
		}

		await expect(
			page.getByRole("heading", { name: "Developers" }),
		).toBeVisible();
		const snippet = main(page).locator("code", { hasText: "claude mcp add" });
		await expect(snippet).toContainText("/api/mcp");
		await snippet.locator("..").getByRole("button", { name: "Copy" }).click();
		await expect(
			snippet.locator("..").getByRole("button", { name: "Copied" }),
		).toBeVisible();
		const copied = await page.evaluate(
			() => (window as unknown as { __copied?: string }).__copied,
		);
		expect(copied).toBe(await snippet.innerText());
	});
});
