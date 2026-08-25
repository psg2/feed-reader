import { describe, expect, it } from "vitest";
import { createTestUser } from "@/tests/factories";
import { getTestDb } from "@/tests/setup";
import * as inviteRepo from "@/server/repos/invites";
import {
	checkInvite,
	consumeInvite,
	evaluateSignup,
	generateInviteToken,
	hashInviteToken,
	INVITE_COOKIE,
	INVITE_REQUIRED_MESSAGE,
	readInviteCookie,
	SIGNUP_CLOSED_MESSAGE,
} from "./signup";

const DAY = 24 * 60 * 60 * 1000;

async function seedInvite(
	db: ReturnType<typeof getTestDb>,
	email: string,
	opts: { expiresAt?: Date; acceptedAt?: Date } = {},
) {
	const admin = await createTestUser(db);
	const token = generateInviteToken();
	const invite = await inviteRepo.createInvite(db, {
		email,
		tokenHash: hashInviteToken(token),
		invitedBy: admin.id,
		expiresAt: opts.expiresAt ?? new Date(Date.now() + DAY),
	});
	if (opts.acceptedAt)
		await inviteRepo.markInviteAccepted(db, invite.id, opts.acceptedAt);
	return { admin, token, invite };
}

describe("evaluateSignup", () => {
	it("is open while the instance has no users (bootstrap)", async () => {
		const db = getTestDb();
		expect(
			await evaluateSignup(db, {
				email: "first@x.com",
				inviteToken: null,
				allowSignup: "false",
			}),
		).toEqual({ allowed: true, inviteId: null });
	});

	it("is closed once a user exists and ALLOW_SIGNUP is false", async () => {
		const db = getTestDb();
		await createTestUser(db);
		expect(
			await evaluateSignup(db, {
				email: "second@x.com",
				inviteToken: null,
				allowSignup: "false",
			}),
		).toEqual({ allowed: false, message: SIGNUP_CLOSED_MESSAGE });
	});

	it("stays open with ALLOW_SIGNUP=true", async () => {
		const db = getTestDb();
		await createTestUser(db);
		expect(
			await evaluateSignup(db, {
				email: "second@x.com",
				inviteToken: null,
				allowSignup: "true",
			}),
		).toEqual({ allowed: true, inviteId: null });
	});

	it("accepts a valid invite for the same e-mail, case-insensitively", async () => {
		const db = getTestDb();
		const { token, invite } = await seedInvite(db, "guest@x.com");
		expect(
			await evaluateSignup(db, {
				email: " Guest@X.com ",
				inviteToken: token,
				allowSignup: "false",
			}),
		).toEqual({ allowed: true, inviteId: invite.id });
	});

	it("rejects an invite for another e-mail", async () => {
		const db = getTestDb();
		const { token } = await seedInvite(db, "guest@x.com");
		expect(
			await evaluateSignup(db, {
				email: "intruder@x.com",
				inviteToken: token,
				allowSignup: "false",
			}),
		).toEqual({ allowed: false, message: INVITE_REQUIRED_MESSAGE });
	});

	it("rejects expired, accepted and unknown invites", async () => {
		const db = getTestDb();
		const expired = await seedInvite(db, "late@x.com", {
			expiresAt: new Date(Date.now() - 1000),
		});
		const used = await seedInvite(db, "used@x.com", {
			acceptedAt: new Date(),
		});
		for (const [email, token] of [
			["late@x.com", expired.token],
			["used@x.com", used.token],
			["nobody@x.com", "not-a-token"],
		]) {
			expect(
				await evaluateSignup(db, {
					email,
					inviteToken: token,
					allowSignup: "false",
				}),
			).toEqual({ allowed: false, message: INVITE_REQUIRED_MESSAGE });
		}
		expect(await checkInvite(db, expired.token)).toEqual({
			ok: false,
			reason: "expired",
		});
		expect(await checkInvite(db, used.token)).toEqual({
			ok: false,
			reason: "accepted",
		});
	});
});

describe("consumeInvite", () => {
	it("marks the invite accepted once", async () => {
		const db = getTestDb();
		const { token, invite } = await seedInvite(db, "guest@x.com");
		expect(await consumeInvite(db, token, "guest@x.com")).toBe(true);
		const [row] = await inviteRepo.listInvites(db);
		expect(row.id).toBe(invite.id);
		expect(row.acceptedAt).toBeInstanceOf(Date);
		expect(await consumeInvite(db, token, "guest@x.com")).toBe(false);
	});

	it("does nothing for a different e-mail", async () => {
		const db = getTestDb();
		const { token } = await seedInvite(db, "guest@x.com");
		expect(await consumeInvite(db, token, "other@x.com")).toBe(false);
		const [row] = await inviteRepo.listInvites(db);
		expect(row.acceptedAt).toBeNull();
	});
});

describe("readInviteCookie", () => {
	it("finds the invite among other cookies and decodes it", () => {
		expect(readInviteCookie(`a=1; ${INVITE_COOKIE}=abc%2Bdef; b=2`)).toBe(
			"abc+def",
		);
		expect(readInviteCookie(`${INVITE_COOKIE}=`)).toBeNull();
		expect(readInviteCookie("a=1")).toBeNull();
		expect(readInviteCookie(null)).toBeNull();
	});
});
