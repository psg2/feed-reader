/**
 * The sign-up policy as BetterAuth enforces it: every account-creating
 * endpoint runs the `user.create.before` hook, so these tests go through
 * `auth.api.signUpEmail` against the test database instead of calling the
 * policy directly.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestUser } from "@/tests/factories";
import { getTestDb } from "@/tests/setup";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";
import * as admin from "@/server/usecases/admin";
import { INVITE_COOKIE } from "@/server/usecases/signup";
import { createAuth } from "./auth";
import { TEST_MCP_CLIENT_ID } from "./cimd";
import { getAppUrl } from "./env";

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

function authRequest(
	auth: ReturnType<typeof createAuth>,
	path: string,
	init?: RequestInit,
) {
	return auth.handler(new Request(`${getAppUrl()}/api/auth${path}`, init));
}

describe("OAuth client discovery (CIMD)", () => {
	it("advertises metadata documents instead of a registration endpoint", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const res = await authRequest(
			auth,
			"/.well-known/oauth-authorization-server",
		);
		const metadata = (await res.json()) as Record<string, unknown>;
		expect(metadata.client_id_metadata_document_supported).toBe(true);
		expect(metadata).not.toHaveProperty("registration_endpoint");
	});

	it("refuses dynamic client registration", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const res = await authRequest(auth, "/oauth2/register", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				client_name: "test",
				token_endpoint_auth_method: "none",
				redirect_uris: ["http://localhost:6274/callback"],
			}),
		});
		expect(res.status).toBe(403);
	});

	it("resolves a metadata-document client_id at authorize", async () => {
		const auth = createAuth(getTestDb(), { allowSignup: "true" });
		const query = new URLSearchParams({
			response_type: "code",
			client_id: TEST_MCP_CLIENT_ID,
			redirect_uri: `${getAppUrl()}/oauth/callback`,
			scope: "openid offline_access",
			state: "state",
			code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
			code_challenge_method: "S256",
		});
		const res = await authRequest(auth, `/oauth2/authorize?${query}`);
		const location = res.headers.get("location") ?? "";
		expect(location).toContain("/sign-in?");
		expect(location).not.toContain("invalid_client");
	});
});

describe("Google sign-in", () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.resetModules();
	});

	it("answers 404 instead of failing when Google isn't configured", async () => {
		vi.stubEnv("GOOGLE_CLIENT_ID", "id.apps.googleusercontent.com");
		vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
		vi.resetModules();
		const { createAuth: createUnconfigured } = await import("./auth");
		const auth = createUnconfigured(getTestDb(), { allowSignup: "true" });

		await expect(
			auth.api.signInSocial({
				body: { provider: "google", callbackURL: "/" },
			}),
		).rejects.toMatchObject({ statusCode: 404 });
	});
});
