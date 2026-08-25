import { db } from "@feedreader/db/client";
import { getRequest } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth";
import { env } from "@/lib/env";
import { isAdmin, parseAdminEmails } from "@/server/usecases/admin";

export interface ServerUser {
	imageUrl: string | null;
	fullName: string | null;
	initials: string;
	email: string | null;
	/** Instance admin (ADMIN_EMAILS, or the first account): sees Settings › Admin. */
	isAdmin: boolean;
}

/** Get user display data for server-side rendering (avatar, name). */
export async function getServerUser(): Promise<ServerUser | undefined> {
	const session = await auth.api.getSession({
		headers: getRequest().headers,
	});
	if (!session?.user) return undefined;

	const { user } = session;
	const nameParts = (user.name ?? "").split(" ").filter(Boolean);
	const initials =
		nameParts.length >= 2
			? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
			: (user.name?.[0] ?? user.email?.[0] ?? "U").toUpperCase();

	return {
		imageUrl: user.image ?? null,
		fullName: user.name ?? null,
		initials,
		email: user.email ?? null,
		isAdmin: await isAdmin(
			db,
			{ id: user.id, email: user.email },
			parseAdminEmails(env.ADMIN_EMAILS),
		),
	};
}

/**
 * Resolve the current BetterAuth session to the internal user UUID.
 *
 * No extra DB query needed — BetterAuth's session lookup returns
 * the user directly, and our users table IS the BetterAuth user table.
 */
export async function getAuthUserId(): Promise<string | null> {
	const session = await auth.api.getSession({
		headers: getRequest().headers,
	});
	return session?.user?.id ?? null;
}
