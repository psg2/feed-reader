import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
	useSession: () => useSession(),
}));

import { SessionProvider, useSessionContext } from "./session-provider";

function Probe() {
	const { session, isPending } = useSessionContext();
	return (
		<div>
			<span data-testid="pending">{String(isPending)}</span>
			<span data-testid="email">{session?.user?.email ?? "none"}</span>
		</div>
	);
}

describe("SessionProvider / useSessionContext", () => {
	it("exposes the session payload from a single useSession call", () => {
		useSession.mockReturnValue({
			data: { user: { id: "u1", email: "a@example.com", name: "Ada" } },
			isPending: false,
		});

		render(
			<SessionProvider>
				<Probe />
			</SessionProvider>,
		);

		expect(screen.getByTestId("email").textContent).toBe("a@example.com");
		expect(screen.getByTestId("pending").textContent).toBe("false");
	});

	it("exposes pending state with no session", () => {
		useSession.mockReturnValue({ data: null, isPending: true });

		render(
			<SessionProvider>
				<Probe />
			</SessionProvider>,
		);

		expect(screen.getByTestId("email").textContent).toBe("none");
		expect(screen.getByTestId("pending").textContent).toBe("true");
	});

	it("throws when used outside the provider", () => {
		const spy = vi.spyOn(console, "error").mockImplementation(() => {});
		expect(() => render(<Probe />)).toThrow(/within <SessionProvider>/);
		spy.mockRestore();
	});
});
