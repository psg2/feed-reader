import { FEEDS } from "./env";
import { expect, openReader, row, rows, test } from "./fixtures";

test.describe("Search, palette and shortcuts", () => {
	test("search narrows the list and says when nothing matches", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first] = await seed.items();

		await openReader(page, "all");
		await expect(rows(page)).toHaveCount(10);
		const search = page.getByPlaceholder("Search");
		await search.fill(first.title);
		await search.press("Enter");
		await expect(page).toHaveURL(/q=/);
		await expect(row(page, first.title)).toBeVisible();
		await expect(rows(page)).toHaveCount(1);

		await search.fill("zzqqxx");
		await search.press("Enter");
		await expect(page.getByText('No posts match "zzqqxx"')).toBeVisible();
		await expect(rows(page)).toHaveCount(0);

		await page.getByRole("button", { name: "Clear search" }).click();
		await expect(rows(page)).toHaveCount(10);
	});

	test("the palette jumps to feeds, runs actions and searches posts", async ({
		page,
		seed,
	}) => {
		const feed = await seed.subscribe(FEEDS.lethain);

		await openReader(page);
		await page.keyboard.press("ControlOrMeta+k");
		const palette = page.locator("[cmdk-root]");
		const input = palette.getByPlaceholder("Jump to, act on, or search…");
		await expect(input).toBeVisible();
		await expect(palette.getByText("Feeds", { exact: true })).toBeVisible();
		const addFeed = palette.getByRole("option", { name: /^Add feed/ });
		await expect(addFeed).toBeVisible();
		await expect(addFeed.locator("kbd")).toHaveText("a");
		await expect(
			palette.getByRole("option", { name: /^Refresh feeds/ }).locator("kbd"),
		).toHaveText("r");

		await palette
			.getByRole("option", { name: /Irrational Exuberance/ })
			.click();
		await expect(palette).toBeHidden();
		await expect(page).toHaveURL(new RegExp(`view=feed(%3A|:)${feed.id}`));
		await expect(
			page.getByRole("heading", { name: "Irrational Exuberance" }),
		).toBeVisible();

		await page.keyboard.press("ControlOrMeta+k");
		await input.fill("zzqqxx");
		await palette
			.getByRole("button", { name: 'Search posts for "zzqqxx"' })
			.click();
		await expect(page).toHaveURL(/q=zzqqxx/);
		await expect(page.getByText('No posts match "zzqqxx"')).toBeVisible();
	});

	test("the shortcuts sheet opens with `?` and from the footer", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await openReader(page);

		const sheet = page.getByRole("dialog", { name: "Keyboard shortcuts" });
		await page.keyboard.press("?");
		await expect(sheet).toBeVisible();
		await expect(sheet.getByText("Mark read, go next")).toBeVisible();
		await page.keyboard.press("Escape");
		await expect(sheet).toBeHidden();

		await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
		await expect(sheet).toBeVisible();
	});
});
