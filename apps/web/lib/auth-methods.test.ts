import { expect, test } from "vitest";
import { resolveAuthMethods } from "./auth-methods";

const google = {
	GOOGLE_CLIENT_ID: "id.apps.googleusercontent.com",
	GOOGLE_CLIENT_SECRET: "secret",
};

const resend = {
	RESEND_API_KEY: "re_123",
	EMAIL_FROM: "Feed Reader <reader@example.com>",
};

test("reports Google disabled when the client secret is missing", () => {
	expect(
		resolveAuthMethods({ GOOGLE_CLIENT_ID: google.GOOGLE_CLIENT_ID }).google,
	).toBe(false);
});

// Vercel keeps a variable whose value was cleared as an empty string.
test("reports Google disabled when a credential is blank", () => {
	expect(
		resolveAuthMethods({ GOOGLE_CLIENT_ID: " ", GOOGLE_CLIENT_SECRET: "s" })
			.google,
	).toBe(false);
});

test("reports Google enabled when both credentials are set", () => {
	expect(resolveAuthMethods(google).google).toBe(true);
});

test("in production without Resend, only password sign-in remains", () => {
	expect(
		resolveAuthMethods({ NODE_ENV: "production", RESEND_API_KEY: "" }),
	).toEqual({
		passwordSignIn: true,
		passwordSignUp: false,
		passwordReset: false,
		emailOtp: false,
		google: false,
	});
});

test("in production, a Resend key without a From address can't deliver", () => {
	expect(
		resolveAuthMethods({
			NODE_ENV: "production",
			RESEND_API_KEY: resend.RESEND_API_KEY,
		}).emailOtp,
	).toBe(false);
});

test("in production with Resend, the email methods are enabled", () => {
	const methods = resolveAuthMethods({ NODE_ENV: "production", ...resend });
	expect(methods.passwordSignUp).toBe(true);
	expect(methods.passwordReset).toBe(true);
	expect(methods.emailOtp).toBe(true);
});

test("in development, email methods work without Resend", () => {
	expect(resolveAuthMethods({ NODE_ENV: "development" }).emailOtp).toBe(true);
});
