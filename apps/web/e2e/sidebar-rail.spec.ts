import { FEEDS } from "./env";
import { expect, openReader, test } from "./fixtures";

test.describe("Sidebar rail", () => {
	test("collapsing keeps the unread badge fully visible", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		await openReader(page);
		await page.keyboard.press("ControlOrMeta+\\");

		const rail = page.getByRole("navigation", { name: "Sidebar" });
		await expect(rail).toHaveCSS("width", "56px");
		const unread = rail.getByRole("link", { name: /^Unread, 5 unread/ });
		await expect(unread).toBeVisible();
		const badge = unread.locator("span", { hasText: "5" });
		const [b, r] = await Promise.all([badge.boundingBox(), rail.boundingBox()]);
		expect(
			b && r && b.x >= r.x && b.y >= r.y && b.x + b.width <= r.x + r.width,
		).toBe(true);

		await page.keyboard.press("ControlOrMeta+\\");
		await expect(rail).toHaveCount(0);
	});
});
