import { db } from "@feedreader/db/client";
import { createServerFn } from "@tanstack/react-start";
import { deleteCookie, setCookie } from "@tanstack/react-start/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { getAuthUserId, getServerUser } from "@/server/auth";
import * as userRepo from "@/server/repos/users";
import {
	checkInvite,
	INVITE_COOKIE,
	INVITE_COOKIE_MAX_AGE,
} from "@/server/usecases/signup";

/**
 * Resolve current BetterAuth session to user UUID.
 * Returns null if not authenticated.
 */
export const getAuthUserIdFn = createServerFn({ method: "GET" }).handler(
	async () => {
		return getAuthUserId();
	},
);

/**
 * Get user display data (avatar, name, initials, admin flag) for
 * server-rendered UI.
 */
export const getServerUserFn = createServerFn({ method: "GET" }).handler(
	async () => {
		return getServerUser();
	},
);

export interface AuthConfig {
	/** Anyone may register: ALLOW_SIGNUP=true, or no account exists yet. */
	allowSignup: boolean;
	/** Google sign-in is only wired when GOOGLE_CLIENT_ID is set. */
	googleEnabled: boolean;
}

async function authConfig(): Promise<AuthConfig> {
	return {
		allowSignup:
			env.ALLOW_SIGNUP === "true" || (await userRepo.countUsers(db)) === 0,
		googleEnabled: !!env.GOOGLE_CLIENT_ID,
	};
}

/**
 * Instance-level auth flags for the public pages, read from env on the
 * server so the client never bundles them.
 */
export const getAuthConfigFn = createServerFn({ method: "GET" }).handler(
	authConfig,
);

export type InviteState =
	| { status: "none" }
	| { status: "valid"; email: string }
	| { status: "invalid" };

export interface SignupPageData extends AuthConfig {
	invite: InviteState;
}

/**
 * Sign-up page data. With `?invite=<token>` the token is checked and, when
 * good, stored in a short-lived httpOnly cookie that the BetterAuth
 * user-creation hook reads back — for the e-mail form and for the Google
 * callback alike. A bad token clears any earlier cookie.
 */
export const getSignupPageFn = createServerFn({ method: "GET" })
	.inputValidator(z.object({ invite: z.string().max(512).optional() }))
	.handler(async ({ data }): Promise<SignupPageData> => {
		const config = await authConfig();
		if (!data.invite) return { ...config, invite: { status: "none" } };

		const check = await checkInvite(db, data.invite);
		if (!check.ok) {
			deleteCookie(INVITE_COOKIE, { path: "/" });
			return { ...config, invite: { status: "invalid" } };
		}
		setCookie(INVITE_COOKIE, data.invite, {
			path: "/",
			httpOnly: true,
			sameSite: "lax",
			secure: env.NODE_ENV === "production",
			maxAge: INVITE_COOKIE_MAX_AGE,
		});
		return {
			...config,
			invite: { status: "valid", email: check.invite.email },
		};
	});
