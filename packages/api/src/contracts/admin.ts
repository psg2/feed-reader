import { oc } from "@orpc/contract";
import { z } from "zod";
import { adminValidators } from "../inputs/admin";
import { adminInvite, adminUser, createdInvite } from "../outputs/admin";

/** Instance administration (Settings › Admin). Every route answers 403 to non-admins. */
export const adminContract = {
	listUsers: oc
		.route({ method: "GET", path: "/admin/users", tags: ["admin"] })
		.input(adminValidators.listUsers)
		.output(z.array(adminUser)),
	deleteUser: oc
		.route({ method: "DELETE", path: "/admin/users/{id}", tags: ["admin"] })
		.input(adminValidators.deleteUser)
		.output(z.object({ success: z.boolean() })),
	listInvites: oc
		.route({ method: "GET", path: "/admin/invites", tags: ["admin"] })
		.input(adminValidators.listInvites)
		.output(z.array(adminInvite)),
	createInvite: oc
		.route({ method: "POST", path: "/admin/invites", tags: ["admin"] })
		.input(adminValidators.createInvite)
		.output(createdInvite),
	revokeInvite: oc
		.route({ method: "DELETE", path: "/admin/invites/{id}", tags: ["admin"] })
		.input(adminValidators.revokeInvite)
		.output(z.object({ success: z.boolean() })),
};
