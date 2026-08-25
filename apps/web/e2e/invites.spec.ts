/**
 * Invitation links on the sign-up page.
 *
 * The suite runs with ALLOW_SIGNUP=true (global-setup signs accounts up),
 * so the "closed" branch of the policy is covered by lib/auth.test.ts; here
 * the link → cookie → BetterAuth hook → invite consumed path is exercised
 * end to end through the real page.
 */
import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "./fixtures";

// The sign-up page redirects signed-in visitors away.
test.use({ storageState: { cookies: [], origins: [] } });

test.describe("Invitations", () => {
	test("a bad invite link says so", async ({ page }) => {
		await page.goto("/sign-up?invite=not-a-real-token");
		await expect(
			page.getByRole("heading", { name: "This invitation isn't valid" }),
		).toBeVisible();
		await expect(page.getByLabel("Email")).toBeHidden();
	});

	test("a valid link pre-fills the address and is consumed by the sign-up", async ({
		page,
		sql,
		account,
	}) => {
		const stamp = randomBytes(4).toString("hex");
		const email = `invited-${stamp}@example.com`;
		const token = randomBytes(32).toString("base64url");
		const tokenHash = createHash("sha256").update(token).digest("hex");
		const [invite] = await sql<{ id: string }[]>`
			insert into invites (email, token_hash, invited_by, expires_at)
			values (${email}, ${tokenHash}, ${account.userId}, now() + interval '1 day')
			returning id
		`;

		try {
			await page.goto(`/sign-up?invite=${encodeURIComponent(token)}`);
			await expect(
				page.getByRole("heading", { name: "You've been invited" }),
			).toBeVisible();
			const emailInput = page.getByLabel("Email");
			await expect(emailInput).toHaveValue(email);
			await expect(emailInput).toHaveAttribute("readonly", "");
			// Typing before hydration would be lost when React takes over.
			await expect(page.locator("form[data-hydrated]")).toBeVisible();

			await page.getByLabel("Name").fill("Invited Guest");
			await page.getByLabel("Password").fill(`pw-${stamp}-invited`);
			await page.getByRole("button", { name: "Create Account" }).click();
			await expect(
				page.getByRole("heading", { name: "Check your email" }),
			).toBeVisible();

			const [row] = await sql<{ accepted_at: string | null }[]>`
				select accepted_at from invites where id = ${invite.id}
			`;
			expect(row.accepted_at).not.toBeNull();
			const [user] = await sql<{ id: string }[]>`
				select id from auth_users where email = ${email}
			`;
			expect(user).toBeDefined();
		} finally {
			await sql`delete from auth_users where email = ${email}`;
			await sql`delete from invites where id = ${invite.id}`;
		}
	});
});
