import type {
	FetchQueryOptions,
	QueryClient,
	QueryKey,
} from "@tanstack/react-query";

/** How long a gate's cached answer is trusted before a background refresh. */
export const GATE_STALE_MS = 5 * 60 * 1000;

/**
 * A route gate's answer without a server round trip on every navigation:
 * the server's first render fills the cache, later navigations read it and
 * refresh it in the background once stale. The API still authorizes every
 * request. A falsy answer is always asked again, so signing in (or being made
 * admin) is seen at once; sign-out clears the cache and impersonation reloads.
 */
export async function loadGate<T, K extends QueryKey>(
	queryClient: QueryClient,
	query: FetchQueryOptions<T, Error, T, K>,
): Promise<T> {
	const cached = queryClient.getQueryData<T>(query.queryKey);
	if (cached) {
		void queryClient.prefetchQuery(query);
		return cached;
	}
	return queryClient.fetchQuery({ ...query, staleTime: 0 });
}
