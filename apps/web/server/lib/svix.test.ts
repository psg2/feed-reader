import { describe, expect, it } from "vitest";
import { signSvix, verifySvixSignature } from "./svix";

const secret = `whsec_${Buffer.from("0123456789abcdef0123456789abcdef").toString("base64")}`;
const body = '{"type":"email.received"}';
const now = 1_700_000_000;

describe("verifySvixSignature", () => {
	it("accepts a valid v1 signature and tolerates extra entries", () => {
		const sig = signSvix(secret, "msg_1", now, body);
		const headers = {
			id: "msg_1",
			timestamp: String(now),
			signature: `v1,bogus ${sig}`,
		};
		expect(verifySvixSignature(secret, headers, body, { now })).toBe(true);
	});

	it("rejects a tampered body, a wrong secret and a stale timestamp", () => {
		const sig = signSvix(secret, "msg_1", now, body);
		const headers = { id: "msg_1", timestamp: String(now), signature: sig };
		expect(verifySvixSignature(secret, headers, `${body} `, { now })).toBe(
			false,
		);
		expect(verifySvixSignature("whsec_AAAA", headers, body, { now })).toBe(
			false,
		);
		expect(verifySvixSignature(secret, headers, body, { now: now + 600 })).toBe(
			false,
		);
		expect(
			verifySvixSignature(secret, { ...headers, signature: null }, body, {
				now,
			}),
		).toBe(false);
	});
});
