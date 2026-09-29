import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
	vi.unstubAllEnvs();
	vi.resetModules();
	vi.restoreAllMocks();
});

test("refuses to send a code in production without Resend instead of logging it", async () => {
	vi.stubEnv("NODE_ENV", "production");
	// lib/env.ts refuses to load in production without a real secret and URL.
	vi.stubEnv("BETTER_AUTH_SECRET", "x".repeat(32));
	vi.stubEnv("BETTER_AUTH_URL", "https://reader.example");
	vi.stubEnv("RESEND_API_KEY", "");
	vi.resetModules();
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const log = vi.spyOn(console, "log").mockImplementation(() => {});
	const { sendOtpEmail } = await import("./email");

	await expect(
		sendOtpEmail({
			to: "user@example.com",
			subject: "Your sign-in code",
			otp: "123456",
			expiresIn: "10 minutes",
		}),
	).rejects.toThrow(/not configured/);
	const output = [...log.mock.calls, ...error.mock.calls].flat().join(" ");
	expect(output).not.toContain("123456");
});
