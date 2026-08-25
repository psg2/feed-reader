import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifies a Svix-style webhook signature (what Resend uses) without the
 * `svix` dependency: HMAC-SHA256 over `${id}.${timestamp}.${body}` keyed with
 * the base64 secret after the `whsec_` prefix, compared against every `v1,…`
 * entry in the signature header. Rejects timestamps outside `toleranceSec`.
 */
export function verifySvixSignature(
	secret: string,
	headers: {
		id: string | null;
		timestamp: string | null;
		signature: string | null;
	},
	body: string,
	opts: { now?: number; toleranceSec?: number } = {},
): boolean {
	const { id, timestamp, signature } = headers;
	if (!id || !timestamp || !signature) return false;
	const ts = Number(timestamp);
	if (!Number.isFinite(ts)) return false;
	const now = opts.now ?? Math.floor(Date.now() / 1000);
	if (Math.abs(now - ts) > (opts.toleranceSec ?? 300)) return false;

	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const expected = createHmac("sha256", key)
		.update(`${id}.${timestamp}.${body}`)
		.digest();
	return signature.split(" ").some((entry) => {
		const [version, sig] = entry.split(",");
		if (version !== "v1" || !sig) return false;
		const given = Buffer.from(sig, "base64");
		return given.length === expected.length && timingSafeEqual(given, expected);
	});
}

/** Test helper / reference implementation: signs a body the way Svix does. */
export function signSvix(
	secret: string,
	id: string,
	timestamp: number,
	body: string,
): string {
	const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
	const sig = createHmac("sha256", key)
		.update(`${id}.${timestamp}.${body}`)
		.digest("base64");
	return `v1,${sig}`;
}
