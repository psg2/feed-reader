import { FEEDS } from "./env";
import { expect, openReader, rows, sidebarLink, test, toast } from "./fixtures";

test.describe("Mark all as read", () => {
	test("in a feed view only that feed is swept, and Undo restores it", async ({
		page,
		seed,
	}) => {
		const a = await seed.subscribe(FEEDS.lethain);
		await seed.subscribe(FEEDS.simon);

		await openReader(page, `feed:${a.id}`);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/10$/);
		await page.getByRole("button", { name: "Mark 5 as read" }).click();

		const done = toast(page, "Marked 5 as read in Irrational Exuberance");
		await expect(done).toBeVisible();
		await expect(sidebarLink(page, /Irrational Exuberance/)).not.toHaveText(
			/\d$/,
		);
		await expect(sidebarLink(page, /Simon Willison/)).toHaveText(/5$/);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/5$/);
		await expect(rows(page).locator(".bg-unread")).toHaveCount(0);
		expect(await seed.unreadCount()).toBe(5);

		await done.getByRole("button", { name: "Undo" }).click();
		await expect(sidebarLink(page, /Irrational Exuberance/)).toHaveText(/5$/);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/10$/);
		await expect(rows(page).locator(".bg-unread")).toHaveCount(5);
		expect(await seed.unreadCount()).toBe(10);
	});

	test("in All it asks first", async ({ page, seed }) => {
		await seed.subscribe(FEEDS.lethain);

		await openReader(page, "all");
		await page.getByRole("button", { name: "Mark 5 as read" }).click();
		await expect(page.getByText("Mark 5 posts as read?")).toBeVisible();
		await page.getByRole("button", { name: "Cancel" }).click();
		await expect(page.getByText("Mark 5 posts as read?")).toBeHidden();
		expect(await seed.unreadCount()).toBe(5);

		await page.getByRole("button", { name: "Mark 5 as read" }).click();
		await page.getByRole("button", { name: "Confirm" }).click();
		await expect(toast(page, "Marked 5 as read in All")).toBeVisible();
		await expect(sidebarLink(page, /^Unread/)).not.toHaveText(/\d$/);
		expect(await seed.unreadCount()).toBe(0);
	});
});
