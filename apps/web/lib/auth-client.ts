"use client";

import { apiKeyClient } from "@better-auth/api-key/client";
import { emailOTPClient, twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/**
 * BetterAuth client instance.
 *
 * Uses `better-auth/react` (NOT `better-auth/client`) for React hooks.
 * No `<AuthProvider>` needed — `useSession()` works standalone via nanostores.
 *
 * No explicit `baseURL` — inherits from page origin for web.
 */
export const authClient = createAuthClient({
	plugins: [
		apiKeyClient(),
		emailOTPClient(),
		twoFactorClient({
			onTwoFactorRedirect() {
				window.location.href = "/two-factor";
			},
		}),
	],
});

export const { useSession, signIn, signUp, signOut } = authClient;
