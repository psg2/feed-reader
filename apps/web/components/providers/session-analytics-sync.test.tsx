import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
	useSession: () => useSession(),
}));

const identify = vi.fn();
const reset = vi.fn();
vi.mock("posthog-js", () => ({
	default: {
		identify: (...args: unknown[]) => identify(...args),
		reset: (...args: unknown[]) => reset(...args),
	},
}));

const setSentryUser = vi.fn();
const clearSentryUser = vi.fn();
vi.mock("@/lib/sentry", () => ({
	setSentryUser: (...args: unknown[]) => setSentryUser(...args),
	clearSentryUser: (...args: unknown[]) => clearSentryUser(...args),
}));

import { SessionAnalyticsSync } from "./session-analytics-sync";
import { SessionProvider } from "./session-provider";

const ada = { id: "user_1", email: "a@example.com", name: "Ada" };

function renderSync() {
	return render(
		<SessionProvider>
			<SessionAnalyticsSync />
		</SessionProvider>,
	);
}

describe("SessionAnalyticsSync", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("does nothing while the session is pending", () => {
		useSession.mockReturnValue({ data: null, isPending: true });
		renderSync();
		expect(identify).not.toHaveBeenCalled();
		expect(reset).not.toHaveBeenCalled();
		expect(setSentryUser).not.toHaveBeenCalled();
		expect(clearSentryUser).not.toHaveBeenCalled();
	});

	it("identifies the user in PostHog and Sentry when signed in", () => {
		useSession.mockReturnValue({ data: { user: ada }, isPending: false });
		renderSync();
		expect(identify).toHaveBeenCalledWith("user_1", {
			email: "a@example.com",
			name: "Ada",
		});
		expect(setSentryUser).toHaveBeenCalledWith({
			id: "user_1",
			email: "a@example.com",
		});
		expect(reset).not.toHaveBeenCalled();
	});

	it("resets PostHog and Sentry when signed out", () => {
		useSession.mockReturnValue({ data: null, isPending: false });
		renderSync();
		expect(reset).toHaveBeenCalledTimes(1);
		expect(clearSentryUser).toHaveBeenCalledTimes(1);
		expect(identify).not.toHaveBeenCalled();
	});

	it("does not re-identify the same user on a session refetch", () => {
		useSession.mockReturnValue({ data: { user: ada }, isPending: false });
		const { rerender } = renderSync();
		expect(identify).toHaveBeenCalledTimes(1);

		// New session object, same user id (better-auth refetch / poll).
		useSession.mockReturnValue({
			data: { user: { ...ada } },
			isPending: false,
		});
		rerender(
			<SessionProvider>
				<SessionAnalyticsSync />
			</SessionProvider>,
		);
		expect(identify).toHaveBeenCalledTimes(1);
	});
});
