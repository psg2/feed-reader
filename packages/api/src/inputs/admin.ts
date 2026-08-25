import { z } from "zod";
import { uuid } from "./common";

export const adminValidators = {
	listUsers: z.object({}).optional(),
	listInvites: z.object({}).optional(),
	createInvite: z.object({ email: z.string().trim().email().max(320) }),
	revokeInvite: z.object({ id: uuid }),
	deleteUser: z.object({ id: uuid }),
};
