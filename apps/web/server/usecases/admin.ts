/**
 * Admin: who administers the instance, and the user/invite management
 * behind Settings › Admin. Authorization (is the caller an admin?) is
 * decided by the oRPC `admin` middleware with `isAdmin`; the functions
 * below trust `actorId`.
 */
import type { db as DB } from "@feedreader/db/client";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";
import {
	generateInviteToken,
	hashInviteToken,
	INVITE_TTL_MS,
	normalizeEmail,
} from "./signup";

type Db = typeof DB;

/** Failures the route layer forwards to the client with their message. */
export class AdminError extends Error {
	constructor(
		public readonly code: "FORBIDDEN" | "NOT_FOUND" | "CONFLICT",
		message: string,
	) {
		super(message);
		this.name = "AdminError";
	}
}

/** ADMIN_EMAILS as a normalised list; empty when unset. */
export function parseAdminEmails(raw: string | undefined): string[] {
	return (raw ?? "")
		.split(",")
		.map(normalizeEmail)
		.filter((e) => e.length > 0);
}

/**
 * Admins are the ADMIN_EMAILS addresses or, when that is unset, the
 * earliest-created account (the person who bootstrapped the instance).
 */
export async function isAdmin(
	db: Db,
	user: { id: string; email: string },
	adminEmails: string[],
): Promise<boolean> {
	if (adminEmails.length > 0)
		return adminEmails.includes(normalizeEmail(user.email));
	const [first] = await userRepo.listUsers(db);
	return first?.id === user.id;
}

export async function isAdminUserId(
	db: Db,
	userId: string,
	adminEmails: string[],
): Promise<boolean> {
	const user = await userRepo.getUserById(db, userId);
	if (!user) return false;
	return isAdmin(db, user, adminEmails);
}

export interface AdminUser {
	id: string;
	name: string;
	email: string;
	createdAt: Date;
	isAdmin: boolean;
}

export async function listUsers(
	db: Db,
	adminEmails: string[],
): Promise<AdminUser[]> {
	const rows = await userRepo.listUsers(db);
	return rows.map((u, i) => ({
		id: u.id,
		name: u.name,
		email: u.email,
		createdAt: u.createdAt,
		isAdmin:
			adminEmails.length > 0
				? adminEmails.includes(normalizeEmail(u.email))
				: i === 0,
	}));
}

export type InviteStatus = "pending" | "expired" | "accepted";

export interface AdminInvite {
	id: string;
	email: string;
	expiresAt: Date;
	acceptedAt: Date | null;
	createdAt: Date;
	status: InviteStatus;
}

export function inviteStatus(
	invite: { expiresAt: Date; acceptedAt: Date | null },
	now: Date,
): InviteStatus {
	if (invite.acceptedAt) return "accepted";
	if (invite.expiresAt.getTime() <= now.getTime()) return "expired";
	return "pending";
}

export async function listInvites(
	db: Db,
	now = new Date(),
): Promise<AdminInvite[]> {
	const rows = await inviteRepo.listInvites(db);
	return rows.map((r) => ({
		id: r.id,
		email: r.email,
		expiresAt: r.expiresAt,
		acceptedAt: r.acceptedAt,
		createdAt: r.createdAt,
		status: inviteStatus(r, now),
	}));
}

export interface InviteEmail {
	to: string;
	url: string;
	host: string;
	expiresAt: Date;
}

export interface CreatedInvite extends AdminInvite {
	/** The invite link; the token inside it is only available now. */
	url: string;
	emailSent: boolean;
}

export function inviteUrl(appUrl: string, token: string): string {
	return `${appUrl.replace(/\/$/, "")}/sign-up?invite=${encodeURIComponent(token)}`;
}

/**
 * Invites `email`. A pending invite for the same address is replaced.
 * `sendEmail` is optional: without it (no e-mail provider configured) the
 * caller shows the link to copy instead.
 */
export async function createInvite(
	db: Db,
	input: {
		actorId: string;
		email: string;
		appUrl: string;
		sendEmail?: (invite: InviteEmail) => Promise<void>;
	},
	now = new Date(),
): Promise<CreatedInvite> {
	const email = normalizeEmail(input.email);
	if (await userRepo.getUserByEmail(db, email))
		throw new AdminError("CONFLICT", `${email} already has an account`);

	const token = generateInviteToken();
	const expiresAt = new Date(now.getTime() + INVITE_TTL_MS);
	await inviteRepo.deletePendingInvitesForEmail(db, email);
	const row = await inviteRepo.createInvite(db, {
		email,
		tokenHash: hashInviteToken(token),
		invitedBy: input.actorId,
		expiresAt,
	});

	const url = inviteUrl(input.appUrl, token);
	let emailSent = false;
	if (input.sendEmail) {
		await input.sendEmail({
			to: email,
			url,
			host: new URL(input.appUrl).host,
			expiresAt,
		});
		emailSent = true;
	}

	return {
		id: row.id,
		email: row.email,
		expiresAt: row.expiresAt,
		acceptedAt: row.acceptedAt,
		createdAt: row.createdAt,
		status: "pending",
		url,
		emailSent,
	};
}

export async function revokeInvite(db: Db, id: string): Promise<void> {
	if (!(await inviteRepo.deleteInvite(db, id)))
		throw new AdminError("NOT_FOUND", "Invite not found");
}

/** Removes an account with everything it owns; never the caller, never the last admin. */
export async function deleteUser(
	db: Db,
	input: { actorId: string; targetId: string; adminEmails: string[] },
): Promise<void> {
	if (input.actorId === input.targetId)
		throw new AdminError("FORBIDDEN", "You cannot remove your own account");
	const all = await listUsers(db, input.adminEmails);
	const target = all.find((u) => u.id === input.targetId);
	if (!target) throw new AdminError("NOT_FOUND", "User not found");
	if (target.isAdmin && all.filter((u) => u.isAdmin).length <= 1)
		throw new AdminError("FORBIDDEN", "Cannot remove the last admin");
	await userRepo.deleteUser(db, input.targetId);
}
