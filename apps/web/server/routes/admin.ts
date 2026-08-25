import { db } from "@feedreader/db/client";
import { ORPCError } from "@orpc/server";
import { isEmailConfigured, sendInviteEmail } from "@/lib/email";
import { env, getAppUrl } from "@/lib/env";
import * as adminUsecase from "@/server/usecases/admin";
import { admin } from "./base";

const adminEmails = () => adminUsecase.parseAdminEmails(env.ADMIN_EMAILS);

/** AdminError carries a message meant for the client; anything else stays generic. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		if (err instanceof adminUsecase.AdminError)
			throw new ORPCError(err.code, { message: err.message });
		throw err;
	}
}

export const adminRouter = {
	listUsers: admin.admin.listUsers.handler(async () => {
		return adminUsecase.listUsers(db, adminEmails());
	}),
	deleteUser: admin.admin.deleteUser.handler(async ({ context, input }) => {
		await run(() =>
			adminUsecase.deleteUser(db, {
				actorId: context.userId,
				targetId: input.id,
				adminEmails: adminEmails(),
			}),
		);
		return { success: true };
	}),
	listInvites: admin.admin.listInvites.handler(async () => {
		return adminUsecase.listInvites(db);
	}),
	createInvite: admin.admin.createInvite.handler(async ({ context, input }) => {
		return run(() =>
			adminUsecase.createInvite(db, {
				actorId: context.userId,
				email: input.email,
				appUrl: getAppUrl(),
				sendEmail: isEmailConfigured() ? sendInviteEmail : undefined,
			}),
		);
	}),
	revokeInvite: admin.admin.revokeInvite.handler(async ({ input }) => {
		await run(() => adminUsecase.revokeInvite(db, input.id));
		return { success: true };
	}),
};
