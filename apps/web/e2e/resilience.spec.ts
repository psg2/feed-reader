import { FEEDS } from "./env";
import { expect, openReader, rows, test } from "./fixtures";

test.describe("Resilience", () => {
	test("a failing server shows an error with a retry, never an empty inbox", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await page.route("**/api/rpc/reader/listItems*", (route) =>
			route.fulfill({ status: 500, body: "boom" }),
		);

		await openReader(page);
		// TanStack Query retries three times with backoff before settling.
		await expect(page.getByText("Couldn't reach the server")).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.getByText("Inbox zero")).toHaveCount(0);

		await page.unroute("**/api/rpc/reader/listItems*");
		await page.getByRole("button", { name: "Try again" }).click();
		await expect(rows(page)).toHaveCount(5);
	});

	test("the theme choice survives a reload", async ({ page, seed }) => {
		await seed.subscribe(FEEDS.lethain);
		await openReader(page);
		const html = page.locator("html");
		await expect(html).not.toHaveClass(/dark/);

		await page.getByRole("button", { name: "Toggle theme" }).click();
		await expect(html).toHaveClass(/dark/);

		await page.reload();
		await expect(page.getByPlaceholder("Search")).toBeVisible();
		await expect(html).toHaveClass(/dark/);
	});
});
