import { FEEDS } from "./env";
import {
	detailTitle,
	expect,
	openReader,
	row,
	rows,
	sidebarLink,
	test,
	unreadDot,
} from "./fixtures";

test.describe("Reading", () => {
	test("selecting keeps a post unread; `u` toggles it and the row leaves Unread once the selection moves", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first, second] = await seed.items();

		await openReader(page);
		await expect(rows(page)).toHaveCount(5);
		await row(page, first.title).click();
		await expect(detailTitle(page)).toHaveText(first.title);
		await expect(unreadDot(page, first.title)).toBeVisible();
		await expect(
			page.getByRole("button", { name: "Mark as read" }),
		).toBeVisible();

		await page.keyboard.press("u");
		await expect(unreadDot(page, first.title)).toHaveCount(0);
		await expect(
			page.getByRole("button", { name: "Mark as unread" }),
		).toBeVisible();
		await expect(rows(page)).toHaveCount(5);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/4$/);
		await expect(sidebarLink(page, /Irrational Exuberance/)).toHaveText(/4$/);
		expect((await seed.items())[0].readAt).not.toBeNull();

		await page.keyboard.press("u");
		await expect(unreadDot(page, first.title)).toBeVisible();
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/5$/);
		expect((await seed.items())[0].readAt).toBeNull();

		await page.keyboard.press("u");
		await expect(unreadDot(page, first.title)).toHaveCount(0);
		await row(page, second.title).click();
		await expect(detailTitle(page)).toHaveText(second.title);
		await expect(row(page, first.title)).toHaveCount(0);
		await expect(rows(page)).toHaveCount(4);
		await expect(unreadDot(page, second.title)).toBeVisible();

		await page.reload();
		await expect(rows(page)).toHaveCount(4);
	});

	test("`e` marks read and advances; `j` / `k` move the selection", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first, second, third] = await seed.items();

		await openReader(page);
		await row(page, first.title).click();
		await expect(detailTitle(page)).toHaveText(first.title);

		await page.keyboard.press("e");
		await expect(detailTitle(page)).toHaveText(second.title);
		await expect(row(page, first.title)).toHaveCount(0);
		await expect(sidebarLink(page, /^Unread/)).toHaveText(/4$/);

		await page.keyboard.press("j");
		await expect(detailTitle(page)).toHaveText(third.title);
		await expect(unreadDot(page, second.title)).toBeVisible();

		await page.keyboard.press("k");
		await expect(detailTitle(page)).toHaveText(second.title);
	});

	test("star with `s`; unstarring from Starred removes the row at once", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first] = await seed.items();

		await openReader(page);
		await row(page, first.title).click();
		await expect(detailTitle(page)).toHaveText(first.title);
		await page.keyboard.press("s");
		await expect(row(page, first.title).locator("svg.fill-star")).toBeVisible();
		await expect(page.getByRole("button", { name: "Unstar" })).toBeVisible();
		await expect.poll(async () => (await seed.items())[0].starred).toBe(true);

		await sidebarLink(page, "Starred").click();
		await expect(page.getByRole("heading", { name: "Starred" })).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await row(page, first.title).click();
		await expect(detailTitle(page)).toHaveText(first.title);

		await page.getByRole("button", { name: "Unstar" }).click();
		await expect(rows(page)).toHaveCount(0);
		await expect(page.getByText("Nothing here.")).toBeVisible();
		await expect(page.getByRole("button", { name: "Star" })).toBeVisible();

		await page.reload();
		await expect(page.getByText("Nothing here.")).toBeVisible();
		await expect(rows(page)).toHaveCount(0);
		expect((await seed.items())[0].starred).toBe(false);
	});
});
