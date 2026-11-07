import { queryOptions } from "@tanstack/react-query";
import { getAuthUserIdFn } from "@/app/server-fns/auth";
import { GATE_STALE_MS } from "@/lib/load-gate";

export const authUserIdGate = queryOptions({
	queryKey: ["gate", "userId"],
	queryFn: () => getAuthUserIdFn(),
	staleTime: GATE_STALE_MS,
	// No component observes a gate, so the default 5 min gcTime would drop it
	// right when it goes stale and turn the background refresh into a wait.
	gcTime: Number.POSITIVE_INFINITY,
});
