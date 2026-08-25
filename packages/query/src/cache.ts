import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Cache helpers for direct cache manipulation.
 *
 * Use these instead of invalidateQueries when the mutation response
 * contains enough data to update the cache without a server roundtrip.
 *
 * Shared between web and mobile — no platform-specific imports.
 */
export const cache = {
	/** Remove an item from a cached array by predicate. */
	removeFromArray<T>({
		queryClient,
		key,
		findFn,
	}: {
		queryClient: QueryClient;
		key: QueryKey;
		findFn: (item: T) => boolean;
	}): void {
		const data = queryClient.getQueryData<T[]>(key);
		if (!data) return;
		queryClient.setQueryData<T[]>(
			key,
			data.filter((item) => !findFn(item)),
		);
	},

	/** Add an item to a cached array. */
	addToArray<T>({
		queryClient,
		key,
		item,
		strategy = "back",
		sortFn,
	}: {
		queryClient: QueryClient;
		key: QueryKey;
		item: T;
		strategy?: "front" | "back";
		sortFn?: (a: T, b: T) => number;
	}): void {
		const data = queryClient.getQueryData<T[]>(key);
		if (!data) return;
		const updated = strategy === "front" ? [item, ...data] : [...data, item];
		queryClient.setQueryData<T[]>(key, sortFn ? updated.sort(sortFn) : updated);
	},

	/** Replace an item in a cached array by predicate. */
	replaceInArray<T>({
		queryClient,
		key,
		findFn,
		item,
		sortFn,
	}: {
		queryClient: QueryClient;
		key: QueryKey;
		findFn: (item: T) => boolean;
		item: T;
		sortFn?: (a: T, b: T) => number;
	}): void {
		const data = queryClient.getQueryData<T[]>(key);
		if (!data) return;
		const updated = data.map((existing) =>
			findFn(existing) ? item : existing,
		);
		queryClient.setQueryData<T[]>(key, sortFn ? updated.sort(sortFn) : updated);
	},
};
