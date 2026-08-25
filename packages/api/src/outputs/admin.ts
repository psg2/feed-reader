import { z } from "zod";

export const adminUser = z.object({
	id: z.string().uuid(),
	name: z.string(),
	email: z.string(),
	createdAt: z.date(),
	isAdmin: z.boolean(),
});

export const inviteStatus = z.enum(["pending", "expired", "accepted"]);

export const adminInvite = z.object({
	id: z.string().uuid(),
	email: z.string(),
	expiresAt: z.date(),
	acceptedAt: z.date().nullable(),
	createdAt: z.date(),
	status: inviteStatus,
});

/** The link is returned once, on creation; the server keeps only a hash. */
export const createdInvite = adminInvite.extend({
	url: z.string(),
	emailSent: z.boolean(),
});
