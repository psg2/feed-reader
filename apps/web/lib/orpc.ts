import type { contract } from "@feedreader/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";

// Client-only: used exclusively by client components via useQuery/useMutation.
// Route loaders call the database directly — they never use this client.
const link = new RPCLink({
	url: () => {
		if (typeof window === "undefined") {
			throw new Error(
				"[orpc] orpcClient must only be used on the client side. Use db directly in route loaders.",
			);
		}
		return `${window.location.origin}/api/rpc`;
	},
});

export const orpcClient: ContractRouterClient<typeof contract> =
	createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);
