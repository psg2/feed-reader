import type { contract } from "@feedreader/api";
import type { ContractRouterClient } from "@orpc/contract";
import type { RouterUtils } from "@orpc/tanstack-query";

/**
 * Composable mutation callbacks.
 *
 * Domain hooks handle cache invalidation internally.
 * Callers provide these for UX behavior (toasts, navigation, form reset).
 */
export interface MutationCallbacks<TData = unknown, TVariables = unknown> {
	onSuccess?: (data: TData, variables: TVariables) => void;
	onError?: (error: Error, variables: TVariables) => void;
	onSettled?: () => void;
}

/**
 * Extra options callers can pass to domain query hooks.
 *
 * queryKey and queryFn are already provided by the domain — callers control
 * everything else: `enabled`, `staleTime`, `select`, `refetchInterval`, etc.
 */
export interface QueryExtra {
	enabled?: boolean;
	staleTime?: number;
	gcTime?: number;
	refetchOnWindowFocus?: boolean | "always";
	refetchOnMount?: boolean | "always";
	refetchOnReconnect?: boolean | "always";
	refetchInterval?: number | false;
	retry?: number | boolean;
	retryDelay?: number | ((attempt: number) => number);
}

/**
 * The oRPC TanStack Query utilities type.
 * Both web and mobile create this from `createTanstackQueryUtils(client)`.
 */
export type OrpcUtils = RouterUtils<ContractRouterClient<typeof contract>>;
