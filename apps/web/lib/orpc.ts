import type { contract } from "@feedreader/api";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { BatchLinkPlugin } from "@orpc/client/plugins";
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
	// A screen fires its queries together; one request lands on one function
	// instance (one cold start at most) so the parts don't arrive out of order.
	// The path names the procedures, so request logs still tell the calls
	// apart. A file or event-iterator output can't ride a batch: keep such a
	// procedure out with `exclude`.
	plugins: [
		new BatchLinkPlugin({
			url: (calls) => batchUrl(calls),
			groups: [{ condition: () => true, context: {} }],
		}),
	],
});

export const orpcClient: ContractRouterClient<typeof contract> =
	createORPCClient(link);

export const orpc = createTanstackQueryUtils(orpcClient);

/** `<prefix>/__batch__/<procedure>,<procedure>`, under the first call's prefix. */
function batchUrl(
	calls: readonly { path: readonly string[]; request: { url: URL } }[],
): string {
	const [first] = calls;
	if (!first) throw new Error("[orpc] empty batch");
	const { origin, pathname } = first.request.url;
	const prefix = pathname.slice(0, -`/${first.path.join("/")}`.length);
	const names = calls.map((call) => call.path.join(".")).join(",");
	return `${origin}${prefix}/__batch__/${names}`;
}
