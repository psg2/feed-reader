/**
 * Sign-up policy.
 *
 * Registration is open when ALLOW_SIGNUP=true, when the instance has no
 * users yet (bootstrap: someone has to create the first account) or when
 * the request carries a valid invitation for the address being registered.
 * The BetterAuth `user.create.before` hook in lib/auth.ts is the single
 * enforcement point, so every sign-up path (e-mail + password, OTP
 * sign-in, Google) goes through here.
 */
import { createHash, randomBytes } from "node:crypto";
import type { db as DB } from "@feedreader/db/client";
import * as inviteRepo from "@/server/repos/invites";
import * as userRepo from "@/server/repos/users";

type Db = typeof DB;

/** Set by the /sign-up?invite= page; read back by the auth hooks. */
export const INVITE_COOKIE = "fr_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 60; // 1 hour, seconds

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const SIGNUP_CLOSED_MESSAGE = "Sign-ups are closed on this instance";
export const INVITE_REQUIRED_MESSAGE =
	"Invitation required: this invite link is invalid, expired or for another e-mail";

export function generateInviteToken(): string {
	return randomBytes(32).toString("base64url");
}

export function hashInviteToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function normalizeEmail(email: string): string {
	return email.trim().toLowerCase();
}

export type InviteCheck =
	| { ok: true; invite: inviteRepo.InviteRow }
	| { ok: false; reason: "unknown" | "expired" | "accepted" | "email" };

/**
 * Looks an invite up by its raw token. With `email`, also requires the
 * invite to be for that address.
 */
export async function checkInvite(
	db: Db,
	token: string,
	email?: string,
	now = new Date(),
): Promise<InviteCheck> {
	if (!token) return { ok: false, reason: "unknown" };
	const invite = await inviteRepo.getInviteByTokenHash(
		db,
		hashInviteToken(token),
	);
	if (!invite) return { ok: false, reason: "unknown" };
	if (invite.acceptedAt) return { ok: false, reason: "accepted" };
	if (invite.expiresAt.getTime() <= now.getTime())
		return { ok: false, reason: "expired" };
	if (email !== undefined && normalizeEmail(email) !== invite.email)
		return { ok: false, reason: "email" };
	return { ok: true, invite };
}

export type SignupDecision =
	| { allowed: true; inviteId: string | null }
	| { allowed: false; message: string };

export async function evaluateSignup(
	db: Db,
	input: {
		email: string;
		inviteToken: string | null;
		/** The ALLOW_SIGNUP env value. */
		allowSignup: "true" | "false";
	},
	now = new Date(),
): Promise<SignupDecision> {
	if (input.allowSignup === "true") return { allowed: true, inviteId: null };
	if ((await userRepo.countUsers(db)) === 0)
		return { allowed: true, inviteId: null };
	if (!input.inviteToken)
		return { allowed: false, message: SIGNUP_CLOSED_MESSAGE };
	const check = await checkInvite(db, input.inviteToken, input.email, now);
	if (!check.ok) return { allowed: false, message: INVITE_REQUIRED_MESSAGE };
	return { allowed: true, inviteId: check.invite.id };
}

/** Marks the invite behind `token` as accepted, if it is the one for `email`. */
export async function consumeInvite(
	db: Db,
	token: string,
	email: string,
	now = new Date(),
): Promise<boolean> {
	const check = await checkInvite(db, token, email, now);
	if (!check.ok) return false;
	await inviteRepo.markInviteAccepted(db, check.invite.id, now);
	return true;
}

/** Value of the invite cookie in a raw `Cookie` header, if any. */
export function readInviteCookie(
	cookieHeader: string | null | undefined,
): string | null {
	if (!cookieHeader) return null;
	for (const part of cookieHeader.split(";")) {
		const eq = part.indexOf("=");
		if (eq < 0) continue;
		if (part.slice(0, eq).trim() !== INVITE_COOKIE) continue;
		const value = part.slice(eq + 1).trim();
		try {
			return decodeURIComponent(value) || null;
		} catch {
			return value || null;
		}
	}
	return null;
}
