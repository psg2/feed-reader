/**
 * The sign-up policy as BetterAuth enforces it: every account-creating
 * endpoint runs the `user.create.before` hook, so these tests go through
 * `auth.api.signUpEmail` against the test database instead of calling the
 * policy directly.
 */
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createTestUser } from "@/tests/factories";
import { getTestDb } from "@/tests/setup";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";
import * as admin from "@/server/usecases/admin";
import { INVITE_COOKIE } from "@/server/usecases/signup";
import { auth as appAuth, createAuth } from "./auth";

// Verification e-mails go to the console without RESEND_API_KEY; keep the
// test output clean.
vi.spyOn(console, "log").mockImplementation(() => {});

// The OAuth provider seeds configured resources during auth initialization.
// Finish the singleton app instance first so test instances observe those rows
// instead of racing it and attempting the same unique inserts concurrently.
beforeAll(async () => {
	await appAuth.$context;
});

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

/**
 * Since BetterAuth 1.7 a 403 from the `user.create.before` hook no longer
 * surfaces on sign-up-email: with email verification on, the endpoint answers
 * a synthetic "check your inbox" response so it can't be used to enumerate
 * accounts. The policy still holds — nothing is written — so the tests assert
 * the user count instead of the error.
 */
async function expectRefused(
	auth: ReturnType<typeof createAuth>,
	email: string,
	cookie?: string,
) {
	const res = await signUp(auth, email, cookie);
	expect(res.token).toBeNull();
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
		await expectRefused(auth, "second@example.com");
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
		await expectRefused(
			auth,
			"intruder@example.com",
			`${INVITE_COOKIE}=${token}`,
		);
		expect(await userRepo.countUsers(db)).toBe(1);

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
		await expectRefused(
			auth,
			"guest2@example.com",
			`${INVITE_COOKIE}=${token}`,
		);
		expect(await userRepo.countUsers(db)).toBe(2);
	});
});

function register(
	auth: ReturnType<typeof createAuth>,
	body: Record<string, unknown>,
) {
	return auth.handler(
		new Request("https://feedreader.localhost/api/auth/oauth2/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: "test",
				token_endpoint_auth_method: "none",
				grant_types: ["authorization_code", "refresh_token"],
				response_types: ["code"],
				...body,
			}),
		}),
	);
}

describe("OAuth dynamic client registration", () => {
	it("treats a loopback-only registration as a native client", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const res = await register(auth, {
			redirect_uris: [
				"http://localhost:6274/callback",
				"http://127.0.0.1:6274/callback",
			],
		});
		expect(res.status).toBe(201);
		const client = (await res.json()) as { application_type?: string };
		expect(client.application_type).toBe("native");
	});

	it("keeps rejecting plain http on non-loopback hosts", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const res = await register(auth, {
			redirect_uris: ["http://example.com/callback"],
		});
		expect(res.status).toBe(400);
		expect(await res.json()).toMatchObject({ error: "invalid_redirect_uri" });
	});

	it("leaves an explicit application_type alone", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const res = await register(auth, {
			application_type: "web",
			redirect_uris: ["http://localhost:6274/callback"],
		});
		expect(res.status).toBe(400);
	});
});
