import { describe, expect, it } from "vitest";
import { createTestUser } from "@/tests/factories";
import { getTestDb } from "@/tests/setup";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";
import * as admin from "./admin";
import { checkInvite } from "./signup";

const APP_URL = "https://reader.example";

describe("isAdmin", () => {
	it("falls back to the earliest-created user when ADMIN_EMAILS is unset", async () => {
		const db = getTestDb();
		const first = await createTestUser(db, {
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const second = await createTestUser(db, {
			createdAt: new Date("2026-01-02T00:00:00Z"),
		});
		expect(await admin.isAdmin(db, first, [])).toBe(true);
		expect(await admin.isAdmin(db, second, [])).toBe(false);
		expect(await admin.isAdminUserId(db, first.id, [])).toBe(true);
		expect(await admin.isAdminUserId(db, crypto.randomUUID(), [])).toBe(false);
	});

	it("uses ADMIN_EMAILS when set, ignoring sign-up order and case", async () => {
		const db = getTestDb();
		const first = await createTestUser(db, {
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const second = await createTestUser(db, {
			email: "Boss@Example.com",
			createdAt: new Date("2026-01-02T00:00:00Z"),
		});
		const emails = admin.parseAdminEmails(" boss@example.com , other@x.com");
		expect(emails).toEqual(["boss@example.com", "other@x.com"]);
		expect(await admin.isAdmin(db, first, emails)).toBe(false);
		expect(await admin.isAdmin(db, second, emails)).toBe(true);
		const listed = await admin.listUsers(db, emails);
		expect(listed.map((u) => [u.email, u.isAdmin])).toEqual([
			[first.email, false],
			["Boss@Example.com", true],
		]);
	});
});

describe("createInvite", () => {
	it("returns the link once, e-mails it when a sender is given", async () => {
		const db = getTestDb();
		const actor = await createTestUser(db);
		const sent: admin.InviteEmail[] = [];
		const before = Date.now();
		const invite = await admin.createInvite(db, {
			actorId: actor.id,
			email: "Friend@Example.com",
			appUrl: APP_URL,
			sendEmail: async (m) => {
				sent.push(m);
			},
		});
		expect(invite.email).toBe("friend@example.com");
		expect(invite.status).toBe("pending");
		expect(invite.emailSent).toBe(true);
		expect(invite.url).toMatch(/^https:\/\/reader\.example\/sign-up\?invite=/);
		expect(invite.expiresAt.getTime() - before).toBeGreaterThan(
			6.9 * 24 * 60 * 60 * 1000,
		);
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({
			to: "friend@example.com",
			url: invite.url,
			host: "reader.example",
		});

		// The link's token is what the sign-up page checks; only its hash is stored.
		const token = new URL(invite.url).searchParams.get("invite") ?? "";
		const check = await checkInvite(db, token, "friend@example.com");
		expect(check.ok).toBe(true);
		const [row] = await inviteRepo.listInvites(db);
		expect(row.tokenHash).not.toBe(token);
	});

	it("reports when no e-mail was sent", async () => {
		const db = getTestDb();
		const actor = await createTestUser(db);
		const invite = await admin.createInvite(db, {
			actorId: actor.id,
			email: "friend@example.com",
			appUrl: APP_URL,
		});
		expect(invite.emailSent).toBe(false);
	});

	it("replaces the pending invite for the same address", async () => {
		const db = getTestDb();
		const actor = await createTestUser(db);
		const first = await admin.createInvite(db, {
			actorId: actor.id,
			email: "friend@example.com",
			appUrl: APP_URL,
		});
		const second = await admin.createInvite(db, {
			actorId: actor.id,
			email: "friend@example.com",
			appUrl: APP_URL,
		});
		const invites = await admin.listInvites(db);
		expect(invites.map((i) => i.id)).toEqual([second.id]);
		const oldToken = new URL(first.url).searchParams.get("invite") ?? "";
		expect(await checkInvite(db, oldToken)).toEqual({
			ok: false,
			reason: "unknown",
		});
	});

	it("refuses an address that already has an account", async () => {
		const db = getTestDb();
		const actor = await createTestUser(db);
		const existing = await createTestUser(db, { email: "taken@example.com" });
		await expect(
			admin.createInvite(db, {
				actorId: actor.id,
				email: existing.email.toUpperCase(),
				appUrl: APP_URL,
			}),
		).rejects.toMatchObject({ code: "CONFLICT" });
	});
});

describe("listInvites / revokeInvite", () => {
	it("derives the status and removes revoked invites", async () => {
		const db = getTestDb();
		const actor = await createTestUser(db);
		const pending = await admin.createInvite(db, {
			actorId: actor.id,
			email: "a@example.com",
			appUrl: APP_URL,
		});
		const expired = await admin.createInvite(
			db,
			{ actorId: actor.id, email: "b@example.com", appUrl: APP_URL },
			new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
		);
		const accepted = await admin.createInvite(db, {
			actorId: actor.id,
			email: "c@example.com",
			appUrl: APP_URL,
		});
		await inviteRepo.markInviteAccepted(db, accepted.id, new Date());

		const byEmail = Object.fromEntries(
			(await admin.listInvites(db)).map((i) => [i.email, i.status]),
		);
		expect(byEmail).toEqual({
			"a@example.com": "pending",
			"b@example.com": "expired",
			"c@example.com": "accepted",
		});

		await admin.revokeInvite(db, pending.id);
		expect((await admin.listInvites(db)).map((i) => i.id)).not.toContain(
			pending.id,
		);
		await expect(admin.revokeInvite(db, expired.id)).resolves.toBeUndefined();
		await expect(admin.revokeInvite(db, pending.id)).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("deleteUser", () => {
	it("removes another account, never the caller or the last admin", async () => {
		const db = getTestDb();
		const owner = await createTestUser(db, {
			createdAt: new Date("2026-01-01T00:00:00Z"),
		});
		const guest = await createTestUser(db, {
			createdAt: new Date("2026-01-02T00:00:00Z"),
		});

		await expect(
			admin.deleteUser(db, {
				actorId: owner.id,
				targetId: owner.id,
				adminEmails: [],
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		// With ADMIN_EMAILS naming only the guest, the owner is a plain user and
		// the guest is the last admin.
		await expect(
			admin.deleteUser(db, {
				actorId: owner.id,
				targetId: guest.id,
				adminEmails: [guest.email],
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });

		await expect(
			admin.deleteUser(db, {
				actorId: owner.id,
				targetId: crypto.randomUUID(),
				adminEmails: [],
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });

		await admin.deleteUser(db, {
			actorId: owner.id,
			targetId: guest.id,
			adminEmails: [],
		});
		expect(await userRepo.getUserById(db, guest.id)).toBeNull();
		expect(await userRepo.countUsers(db)).toBe(1);
	});

	it("lets one admin remove another when two are configured", async () => {
		const db = getTestDb();
		const a = await createTestUser(db);
		const b = await createTestUser(db);
		await admin.deleteUser(db, {
			actorId: a.id,
			targetId: b.id,
			adminEmails: [a.email, b.email],
		});
		expect(await userRepo.getUserById(db, b.id)).toBeNull();
	});
});
