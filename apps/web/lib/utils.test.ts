import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
	it.each([
		["text-ui", "text-muted-foreground", "text-ui text-muted-foreground"],
		["text-2xs", "text-primary", "text-2xs text-primary"],
		["leading-reading", "text-foreground", "leading-reading text-foreground"],
		["max-w-prose", "max-w-measure", "max-w-measure"],
	])("keeps app tokens: %s + %s", (a, b, expected) => {
		expect(cn(a, b)).toBe(expected);
	});
});
