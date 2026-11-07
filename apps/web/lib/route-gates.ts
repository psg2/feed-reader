import { queryOptions } from "@tanstack/react-query";
import { getAuthUserIdFn } from "@/app/server-fns/auth";
import { GATE_STALE_MS } from "@/lib/load-gate";

export const authUserIdGate = queryOptions({
	queryKey: ["gate", "userId"],
	queryFn: () => getAuthUserIdFn(),
	staleTime: GATE_STALE_MS,
});
