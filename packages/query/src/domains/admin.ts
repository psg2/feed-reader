"use client";

import type { CreatedInvite } from "@feedreader/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationCallbacks, OrpcUtils, QueryExtra } from "../types";

export function createAdminDomain(orpc: OrpcUtils) {
	function useInvalidateInvites() {
		const qc = useQueryClient();
		return () =>
			qc.invalidateQueries({ queryKey: orpc.admin.listInvites.key() });
	}

	return {
		useUsers: (options?: QueryExtra) =>
			useQuery({
				...orpc.admin.listUsers.queryOptions({ input: undefined }),
				...options,
			}),

		useInvites: (options?: QueryExtra) =>
			useQuery({
				...orpc.admin.listInvites.queryOptions({ input: undefined }),
				...options,
			}),

		useCreateInvite: (
			callbacks?: MutationCallbacks<CreatedInvite, { email: string }>,
		) => {
			const invalidate = useInvalidateInvites();
			return useMutation({
				...orpc.admin.createInvite.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (error, variables) => callbacks?.onError?.(error, variables),
				onSettled: () => callbacks?.onSettled?.(),
			});
		},

		useRevokeInvite: (
			callbacks?: MutationCallbacks<unknown, { id: string }>,
		) => {
			const invalidate = useInvalidateInvites();
			return useMutation({
				...orpc.admin.revokeInvite.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (error, variables) => callbacks?.onError?.(error, variables),
				onSettled: () => callbacks?.onSettled?.(),
			});
		},

		useDeleteUser: (callbacks?: MutationCallbacks<unknown, { id: string }>) => {
			const qc = useQueryClient();
			return useMutation({
				...orpc.admin.deleteUser.mutationOptions(),
				onSuccess: (data, variables) => {
					qc.invalidateQueries({ queryKey: orpc.admin.listUsers.key() });
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (error, variables) => callbacks?.onError?.(error, variables),
				onSettled: () => callbacks?.onSettled?.(),
			});
		},
	};
}
