import { FEEDS } from "./env";
import {
	expect,
	openReader,
	rows,
	sidebar,
	sidebarLink,
	test,
	toast,
} from "./fixtures";

test.describe("First run", () => {
	test("a new account is asked for its first feed, then lands on it", async ({
		page,
	}) => {
		await openReader(page);
		await expect(
			page.getByRole("heading", { name: "Add your first feed" }),
		).toBeVisible();
		await expect(
			sidebar(page).getByRole("button", { name: "Add your first feed" }),
		).toBeVisible();

		await page.getByPlaceholder("Feed or site URL").fill(FEEDS.lethain);
		await page.getByRole("button", { name: "Add", exact: true }).click();

		await expect(
			toast(page, "Subscribed to Irrational Exuberance · 5 unread"),
		).toBeVisible();
		await expect(page).toHaveURL(/view=feed(%3A|:)/);
		await expect(
			page.getByRole("heading", { name: "Irrational Exuberance" }),
		).toBeVisible();
		await expect(rows(page)).toHaveCount(10);
		await expect(
			page.getByRole("heading", { name: "Add your first feed" }),
		).toBeHidden();

		const feedLink = sidebarLink(page, /Irrational Exuberance/);
		await expect(feedLink).toBeVisible();
		await expect(feedLink).toHaveText(/5$/);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/5$/);
	});
});
