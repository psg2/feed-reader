import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useSession } from "@/lib/auth-client";

type UseSessionData = ReturnType<typeof useSession>["data"];

type SessionContextValue = {
	session: UseSessionData;
	isPending: boolean;
};

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Single subscription point for the auth session.
 *
 * Calls `useSession()` exactly once and shares the result via context so
 * downstream components read the session without each opening their own
 * nanostore subscription. The value is a drop-in for `useSession()`'s
 * `{ data, isPending }` — `session` is the full payload (`.user` and
 * `.session`).
 */
export function SessionProvider({
	children,
}: {
	children: ReactNode;
}): React.ReactElement {
	const { data: session, isPending } = useSession();
	const value = useMemo<SessionContextValue>(
		() => ({ session, isPending }),
		[session, isPending],
	);
	return <SessionContext value={value}>{children}</SessionContext>;
}

export function useSessionContext(): SessionContextValue {
	const ctx = useContext(SessionContext);
	if (ctx === null) {
		throw new Error("useSessionContext must be used within <SessionProvider>");
	}
	return ctx;
}
