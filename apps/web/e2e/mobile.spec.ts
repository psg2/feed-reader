import { FEEDS } from "./env";
import { detailTitle, expect, openReader, row, rows, test } from "./fixtures";

test.describe("Mobile", () => {
	test("list → post shows the bottom bar; mark read & next advances; List and Esc go back", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first, second] = await seed.items();

		await openReader(page);
		await expect(page.getByRole("navigation")).toBeHidden();
		await expect(rows(page)).toHaveCount(5);

		await row(page, first.title).click();
		await expect(detailTitle(page)).toHaveText(first.title);
		await expect(page.getByPlaceholder("Search")).toBeHidden();
		const readAndNext = page.getByRole("button", { name: "Mark read & next" });
		await expect(readAndNext).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Previous post" }),
		).toBeDisabled();

		await readAndNext.click();
		await expect(detailTitle(page)).toHaveText(second.title);
		await expect
			.poll(async () => (await seed.items())[0].readAt)
			.not.toBeNull();

		await page.getByRole("link", { name: "List" }).click();
		await expect(page.getByPlaceholder("Search")).toBeVisible();
		await expect(row(page, first.title)).toHaveCount(0);
		await expect(rows(page)).toHaveCount(4);

		await row(page, second.title).click();
		await expect(detailTitle(page)).toHaveText(second.title);
		await page.keyboard.press("Escape");
		await expect(page.getByPlaceholder("Search")).toBeVisible();
		await expect(detailTitle(page)).toBeHidden();
	});

	test("the header menu offers mark all and refresh", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await openReader(page);

		await page.getByRole("button", { name: "More actions" }).click();
		await expect(
			page.getByRole("menuitem", { name: "Mark 5 as read" }),
		).toBeVisible();
		await expect(page.getByRole("menuitem", { name: "Refresh" })).toBeVisible();
	});
});
