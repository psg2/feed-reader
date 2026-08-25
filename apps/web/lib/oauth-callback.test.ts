import { describe, expect, it } from "vitest";
import { safePath, toOAuthCallbackURL } from "./oauth-callback";

describe("toOAuthCallbackURL", () => {
	it("keeps fragment-free paths untouched", () => {
		expect(toOAuthCallbackURL("/dashboard")).toBe("/dashboard");
		expect(toOAuthCallbackURL("/posts?page=2&sort=asc")).toBe(
			"/posts?page=2&sort=asc",
		);
	});

	it("strips the #fragment that BetterAuth rejects", () => {
		expect(toOAuthCallbackURL("/posts?page=2#comments")).toBe("/posts?page=2");
		expect(toOAuthCallbackURL("/dashboard#section")).toBe("/dashboard");
	});
});

describe("safePath", () => {
	it("accepts internal paths", () => {
		expect(safePath("/posts?page=2#comments")).toBe("/posts?page=2#comments");
	});

	it("falls back when the target is missing or external", () => {
		expect(safePath(undefined)).toBe("/reader");
		expect(safePath("https://evil.com")).toBe("/reader");
		expect(safePath("//evil.com")).toBe("/reader");
		expect(safePath("/\\evil.com")).toBe("/reader");
	});

	it("honors a custom fallback", () => {
		expect(safePath(undefined, "/home")).toBe("/home");
	});
});
