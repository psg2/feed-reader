/**
 * The sign-up policy as BetterAuth enforces it: every account-creating
 * endpoint runs the `user.create.before` hook, so these tests go through
 * `auth.api.signUpEmail` against the test database instead of calling the
 * policy directly.
 */
import { describe, expect, it, vi } from "vitest";
import { createTestUser } from "@/tests/factories";
import { getTestDb } from "@/tests/setup";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";
import * as admin from "@/server/usecases/admin";
import { INVITE_COOKIE } from "@/server/usecases/signup";
import { createAuth } from "./auth";

// Verification e-mails go to the console without RESEND_API_KEY; keep the
// test output clean.
vi.spyOn(console, "log").mockImplementation(() => {});

function signUp(
	auth: ReturnType<typeof createAuth>,
	email: string,
	cookie?: string,
) {
	return auth.api.signUpEmail({
		body: { name: "Guest", email, password: "correct horse battery" },
		headers: new Headers(cookie ? { cookie } : {}),
	});
}

describe("BetterAuth sign-up policy", () => {
	it("creates the first account even with sign-ups closed", async () => {
		const db = getTestDb();
		const auth = createAuth(db, { allowSignup: "false" });
		const res = await signUp(auth, "first@example.com");
		expect(res.user.email).toBe("first@example.com");
		expect(await userRepo.countUsers(db)).toBe(1);
	});

	it("refuses a second account without an invite", async () => {
		const db = getTestDb();
		await createTestUser(db);
		const auth = createAuth(db, { allowSignup: "false" });
		await expect(signUp(auth, "second@example.com")).rejects.toMatchObject({
			status: "FORBIDDEN",
			message: expect.stringContaining("Sign-ups are closed"),
		});
		expect(await userRepo.countUsers(db)).toBe(1);
	});

	it("keeps accepting accounts with ALLOW_SIGNUP=true", async () => {
		const db = getTestDb();
		await createTestUser(db);
		const auth = createAuth(db, { allowSignup: "true" });
		await signUp(auth, "second@example.com");
		expect(await userRepo.countUsers(db)).toBe(2);
	});

	it("accepts an invited address and consumes the invite", async () => {
		const db = getTestDb();
		const owner = await createTestUser(db);
		const invite = await admin.createInvite(db, {
			actorId: owner.id,
			email: "guest@example.com",
			appUrl: "https://reader.example",
		});
		const token = new URL(invite.url).searchParams.get("invite") ?? "";
		const auth = createAuth(db, { allowSignup: "false" });

		// Same token, other address: still closed.
		await expect(
			signUp(auth, "intruder@example.com", `${INVITE_COOKIE}=${token}`),
		).rejects.toMatchObject({ status: "FORBIDDEN" });

		const res = await signUp(
			auth,
			"Guest@example.com",
			`other=1; ${INVITE_COOKIE}=${encodeURIComponent(token)}`,
		);
		expect(res.user.email).toBe("guest@example.com");
		const [row] = await inviteRepo.listInvites(db);
		expect(row.id).toBe(invite.id);
		expect(row.acceptedAt).toBeInstanceOf(Date);

		// A used invite doesn't open the door again.
		await expect(
			signUp(auth, "guest2@example.com", `${INVITE_COOKIE}=${token}`),
		).rejects.toMatchObject({ status: "FORBIDDEN" });
	});
});
