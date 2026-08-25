import { FEEDS } from "./env";
import {
	detailTitle,
	expect,
	main,
	openReader,
	row,
	rows,
	sidebarLink,
	test,
} from "./fixtures";

test.describe("Notes and tags", () => {
	test("notes autosave with a status and survive a reload", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first] = await seed.items();
		// Hold the save long enough for "Saving…" to be observable (the
		// assertion polls about once a second once it has been waiting a while).
		await page.route("**/api/rpc/reader/updateItem", async (route) => {
			await new Promise((r) => setTimeout(r, 1500));
			await route.continue();
		});

		await openReader(page);
		await row(page, first.title).click();
		const notes = main(page).getByPlaceholder("Notes…");
		await notes.fill("Worth re-reading before the next planning cycle.");
		await expect(main(page).getByText("Saving…")).toBeVisible();
		await expect(main(page).getByText("Saved", { exact: true })).toBeVisible();
		await expect
			.poll(async () => (await seed.item(first.id)).notes)
			.toBe("Worth re-reading before the next planning cycle.");

		await page.reload();
		await expect(detailTitle(page)).toHaveText(first.title);
		await expect(page.getByPlaceholder("Notes…")).toHaveValue(
			"Worth re-reading before the next planning cycle.",
		);
	});

	test("tags are added with Enter and comma, removed, persisted, and listed in the sidebar", async ({
		page,
		seed,
	}) => {
		await seed.subscribe(FEEDS.lethain);
		const [first] = await seed.items();

		await openReader(page);
		await row(page, first.title).click();
		const input = main(page).getByLabel("Tags");
		await input.fill("Alpha");
		await input.press("Enter");
		await input.pressSequentially("beta,");
		const chips = input
			.locator("..")
			.locator("span", { hasText: /^(alpha|beta)$/ });
		await expect(chips.filter({ hasText: "alpha" })).toBeVisible();
		await expect(chips.filter({ hasText: "beta" })).toBeVisible();
		await expect(input).toHaveValue("");
		await expect
			.poll(async () => (await seed.item(first.id)).tags)
			.toEqual(["alpha", "beta"]);

		await page.getByRole("button", { name: "Remove tag alpha" }).click();
		await expect(chips.filter({ hasText: "alpha" })).toBeHidden();
		await expect
			.poll(async () => (await seed.item(first.id)).tags)
			.toEqual(["beta"]);

		await page.reload();
		await expect(detailTitle(page)).toHaveText(first.title);
		await expect(chips.filter({ hasText: "beta" })).toBeVisible();
		await expect(chips.filter({ hasText: "alpha" })).toBeHidden();

		await expect(sidebarLink(page, "beta")).toBeVisible();
		await sidebarLink(page, "beta").click();
		await expect(page.getByRole("heading", { name: "#beta" })).toBeVisible();
		await expect(rows(page)).toHaveCount(1);
		await expect(row(page, first.title)).toBeVisible();

		// Dropping the tag from inside its own view removes the row at once.
		await row(page, first.title).click();
		await page.getByRole("button", { name: "Remove tag beta" }).click();
		await expect(rows(page)).toHaveCount(0);
		await expect(sidebarLink(page, "beta")).toBeHidden();
	});
});
