"use client";

import type { ReaderFilter, ReaderItem } from "@feedreader/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { cache } from "../cache";
import type { MutationCallbacks, OrpcUtils, QueryExtra } from "../types";

/** Whether `item`, as patched by the mutation, still belongs to `filter`'s view. */
function stillInView(
	filter: ReaderFilter,
	item: ReaderItem,
	nextTags: string[] | undefined,
): boolean {
	switch (filter.kind) {
		case "all":
			return true;
		case "unread":
			// Read state is the exception: the row stays until the selection moves.
			return true;
		case "starred":
			return item.starred;
		case "feed":
			return item.feedId === filter.feedId;
		case "tag":
			return nextTags === undefined || nextTags.includes(filter.tag);
	}
}

function sameKey(a: readonly unknown[], b: readonly unknown[]): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

export function createReaderDomain(orpc: OrpcUtils) {
	const itemsKey = (input: {
		filter: ReaderFilter;
		search: string;
		limit: number;
	}) => orpc.reader.listItems.key({ input, type: "query" });

	function useInvalidate() {
		const qc = useQueryClient();
		return () => {
			qc.invalidateQueries({ queryKey: orpc.reader.listItems.key() });
			qc.invalidateQueries({ queryKey: orpc.reader.listFeeds.key() });
			qc.invalidateQueries({ queryKey: orpc.reader.listTags.key() });
		};
	}

	return {
		useItems: (
			input: { filter: ReaderFilter; search: string; limit: number },
			options?: QueryExtra,
		) =>
			useQuery({
				...orpc.reader.listItems.queryOptions({ input }),
				...options,
			}),

		useItem: (itemId: string, options?: QueryExtra) =>
			useQuery({
				...orpc.reader.getItem.queryOptions({ input: { itemId } }),
				...options,
			}),

		useFeeds: (options?: QueryExtra) =>
			useQuery({
				...orpc.reader.listFeeds.queryOptions({ input: undefined }),
				...options,
			}),

		useTags: (options?: QueryExtra) =>
			useQuery({
				...orpc.reader.listTags.queryOptions({ input: undefined }),
				...options,
			}),

		useInboundAddress: (options?: QueryExtra) =>
			useQuery({
				...orpc.reader.inboundAddress.queryOptions({ input: undefined }),
				staleTime: Number.POSITIVE_INFINITY,
				...options,
			}),

		useConnectedApps: (options?: QueryExtra) =>
			useQuery({
				...orpc.reader.connectedApps.queryOptions({ input: undefined }),
				...options,
			}),

		useRevokeApp: (callbacks?: MutationCallbacks) => {
			const qc = useQueryClient();
			return useMutation({
				...orpc.reader.revokeApp.mutationOptions(),
				onSuccess: (data, variables) => {
					qc.invalidateQueries({ queryKey: orpc.reader.connectedApps.key() });
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (err, variables) => {
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
			});
		},

		useImportOpml: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.importOpml.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (err, variables) => {
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
			});
		},

		/**
		 * Read/star/notes/tags on one item. Read and star flip optimistically in
		 * the list row and the detail header; the server row replaces them on
		 * success and the snapshot comes back on error.
		 *
		 * A change that takes the item out of the current view (unstar in
		 * Starred, dropping the tag in a tag view) removes the row at once. The
		 * one exception is read state in Unread: the row stays, so `u` can be
		 * undone in place, until the selection moves (see `usePruneReadFromUnread`).
		 */
		useUpdateItem: (
			listInput: { filter: ReaderFilter; search: string; limit: number },
			callbacks?: MutationCallbacks,
		) => {
			const qc = useQueryClient();
			const listKey = itemsKey(listInput);
			return useMutation({
				...orpc.reader.updateItem.mutationOptions(),
				onMutate: async (variables) => {
					const detailKey = orpc.reader.getItem.queryOptions({
						input: { itemId: variables.itemId },
					}).queryKey;
					// A refetch landing mid-mutation would overwrite the optimistic row.
					await Promise.all([
						qc.cancelQueries({ queryKey: listKey }),
						qc.cancelQueries({ queryKey: detailKey }),
					]);
					const patch = <T extends ReaderItem>(i: T): T => ({
						...i,
						...(variables.read !== undefined
							? { readAt: variables.read ? new Date() : null }
							: {}),
						...(variables.starred !== undefined
							? { starred: variables.starred }
							: {}),
					});
					const listBefore = qc.getQueryData<ReaderItem[]>(listKey);
					const detailBefore = qc.getQueryData(detailKey);
					if (listBefore) {
						qc.setQueryData<ReaderItem[]>(
							listKey,
							listBefore
								.map((i) => (i.id === variables.itemId ? patch(i) : i))
								.filter(
									(i) =>
										i.id !== variables.itemId ||
										stillInView(listInput.filter, i, variables.tags),
								),
						);
					}
					if (detailBefore) {
						qc.setQueryData(detailKey, patch(detailBefore));
					}
					const itemBefore = listBefore?.find((i) => i.id === variables.itemId);
					const indexBefore = listBefore?.findIndex(
						(i) => i.id === variables.itemId,
					);
					return { itemBefore, indexBefore, detailBefore, detailKey };
				},
				onSuccess: (updated, variables) => {
					if (updated) {
						cache.replaceInArray<ReaderItem>({
							queryClient: qc,
							key: listKey,
							findFn: (i) => i.id === updated.id,
							item: updated,
						});
					}
					callbacks?.onSuccess?.(updated, variables);
				},
				onError: (err, variables, context) => {
					// Put back only the patched row; other rows may have moved on since.
					const before = context?.itemBefore;
					if (before) {
						qc.setQueryData<ReaderItem[]>(listKey, (list) => {
							if (!list) return list;
							const idx = list.findIndex((i) => i.id === before.id);
							if (idx >= 0)
								return list.map((i) => (i.id === before.id ? before : i));
							const next = [...list];
							next.splice(
								Math.min(context.indexBefore ?? list.length, list.length),
								0,
								before,
							);
							return next;
						});
					}
					if (context?.detailBefore)
						qc.setQueryData(context.detailKey, context.detailBefore);
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
				onSettled: (_data, _error, variables) => {
					// Every other list (and the sidebar counts) re-reads the server.
					// The current Unread list is left alone after a read toggle so the
					// row the user just acted on doesn't vanish under the cursor.
					const keepCurrent =
						listInput.filter.kind === "unread" && variables.read !== undefined;
					qc.invalidateQueries({
						queryKey: orpc.reader.listItems.key(),
						predicate: (q) => !keepCurrent || !sameKey(q.queryKey, listKey),
					});
					qc.invalidateQueries({ queryKey: orpc.reader.getItem.key() });
					qc.invalidateQueries({ queryKey: orpc.reader.listFeeds.key() });
					qc.invalidateQueries({ queryKey: orpc.reader.listTags.key() });
					callbacks?.onSettled?.();
				},
			});
		},

		/**
		 * Drops read rows from the cached Unread list, keeping the row about to
		 * be selected. Called when the selection moves: that is when a row marked
		 * read in place is allowed to leave the view. `dropId` also removes a row
		 * whose read mutation was just fired (the optimistic patch lands a tick
		 * later, so "mark read & next" names it explicitly).
		 */
		usePruneReadFromUnread: () => {
			const qc = useQueryClient();
			return (
				listInput: { filter: ReaderFilter; search: string; limit: number },
				keepId?: string,
				dropId?: string,
			) => {
				if (listInput.filter.kind !== "unread") return;
				const key = itemsKey(listInput);
				const list = qc.getQueryData<ReaderItem[]>(key);
				if (!list) return;
				const kept = list.filter(
					(i) => i.id !== dropId && (i.readAt === null || i.id === keepId),
				);
				if (kept.length !== list.length) qc.setQueryData(key, kept);
			};
		},

		/** Bulk read/unread — used by mark-all undo. Invalidates everything. */
		useMarkRead: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.markRead.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
			});
		},

		useMarkAllRead: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.markAllRead.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
			});
		},

		useSubscribe: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.subscribe.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (err, variables) => {
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
			});
		},

		useRemoveFeed: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.removeFeed.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
			});
		},

		useUpdateFeed: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.updateFeed.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
			});
		},

		useRefresh: (callbacks?: MutationCallbacks) => {
			const invalidate = useInvalidate();
			return useMutation({
				...orpc.reader.refresh.mutationOptions(),
				onSuccess: (data, variables) => {
					invalidate();
					callbacks?.onSuccess?.(data, variables);
				},
				onError: (err, variables) => {
					callbacks?.onError?.(
						err instanceof Error ? err : new Error(String(err)),
						variables,
					);
				},
			});
		},
	};
}
