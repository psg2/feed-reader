"use client";

import { createAdminDomain } from "./domains/admin";
import { createReaderDomain } from "./domains/reader";
import type { OrpcUtils } from "./types";

/**
 * Create a centralized API client with query + mutation hooks for all domains.
 *
 * Each domain bundles:
 * - Query hooks (`useList`, `useGet`, etc.) that ensure correct query keys
 * - Mutation hooks (`useCreate`, `useUpdate`, `useDelete`) that handle cache
 *   manipulation and accept composable `MutationCallbacks`
 *
 * @example
 * ```ts
 * // apps/web/lib/api.ts
 * import { createApiClient } from "@feedreader/query";
 * import { orpc } from "./orpc";
 * export const api = createApiClient(orpc);
 *
 * // In a component:
 * const { data: feeds } = api.reader.useFeeds();
 * const subscribe = api.reader.useSubscribe({
 *   onSuccess: () => toast.success("Subscribed"),
 * });
 * ```
 */
export function createApiClient(orpc: OrpcUtils) {
	return {
		reader: createReaderDomain(orpc),
		admin: createAdminDomain(orpc),
	};
}

export type ApiClient = ReturnType<typeof createApiClient>;
