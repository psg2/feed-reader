import { type Database, db } from "@feedreader/db/client";
import {
	authAccounts,
	authApiKeys,
	authRateLimits,
	authSessions,
	oauthAccessTokens,
	oauthClients,
	oauthConsents,
	oauthRefreshTokens,
	twoFactors,
	users,
	verifications,
} from "@feedreader/db/schema";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { betterAuth } from "better-auth/minimal";
import { emailOTP, oAuthProxy, twoFactor } from "better-auth/plugins";
import {
	consumeInvite,
	evaluateSignup,
	INVITE_COOKIE,
	readInviteCookie,
} from "@/server/usecases/signup";
import { sendOtpEmail } from "./email";
import { env, getAppUrl } from "./env";

export interface AuthOptions {
	/** ALLOW_SIGNUP; the tests pass it explicitly. */
	allowSignup: "true" | "false";
}

/**
 * BetterAuth server instance.
 *
 * Configured with:
 * - Drizzle adapter pointing to our PostgreSQL database
 * - Email + password auth with email verification
 * - Google OAuth social provider
 * - Admin plugin for user management
 * - API key plugin for automation
 * - Two-factor authentication (TOTP + email OTP + backup codes)
 * - Email OTP for verification and passwordless sign-in
 * - UUID generation for IDs (matches our domain tables)
 *
 * TanStack Start note: we do NOT use nextCookies() here. API route handlers
 * pass the raw request, and server functions use getRequest() from
 * @tanstack/react-start/server to get headers.
 */
export function createAuth(
	database: Database,
	options: AuthOptions = { allowSignup: env.ALLOW_SIGNUP },
) {
	return betterAuth({
		baseURL: env.BETTER_AUTH_URL,
		secret: env.BETTER_AUTH_SECRET,

		// In dev/preview, accept any *.localhost origin so portless's
		// branch-prefixed URLs (e.g. https://feat-x.feedreader.localhost) and a
		// renamed portless project (https://<name>.localhost) work without extra
		// config. In production, match the configured BETTER_AUTH_URL strictly.
		trustedOrigins:
			env.NODE_ENV === "production"
				? env.BETTER_AUTH_URL
					? [env.BETTER_AUTH_URL]
					: []
				: (request) => {
						const origin = request?.headers.get("origin") ?? "";
						try {
							const { hostname } = new URL(origin);
							if (hostname === "localhost" || hostname.endsWith(".localhost")) {
								return [origin];
							}
						} catch {
							/* malformed origin — fall through */
						}
						return env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : [];
					},

		rateLimit: {
			enabled: true,
			storage: "database",
			window: 60,
			max: 30,
			customRules: {
				"/sign-in/email": { window: 60, max: 5 },
				"/sign-up/email": { window: 60, max: 5 },
				"/email-otp/*": { window: 60, max: 5 },
				"/two-factor/*": { window: 60, max: 5 },
			},
		},

		database: drizzleAdapter(database, {
			provider: "pg",
			schema: {
				user: users,
				session: authSessions,
				account: authAccounts,
				verification: verifications,
				twoFactor: twoFactors,
				rateLimit: authRateLimits,
				apikey: authApiKeys,
				oauthClient: oauthClients,
				oauthAccessToken: oauthAccessTokens,
				oauthRefreshToken: oauthRefreshTokens,
				oauthConsent: oauthConsents,
			},
		}),

		advanced: {
			// Vercel collapses every request to its own proxy IP at the socket layer,
			// so without these headers the per-IP rate limit above is effectively a
			// per-instance global limit (one bad actor burns the budget for everyone).
			// Order matters — the first header that resolves wins; Vercel's own
			// header is more trustworthy than the generic x-forwarded-for.
			ipAddress: {
				ipAddressHeaders: ["x-vercel-forwarded-for", "x-forwarded-for"],
			},
			database: {
				generateId: () => crypto.randomUUID(),
			},
		},

		onAPIError: {
			errorURL: "/sign-in",
		},

		account: {
			storeStateStrategy: "cookie",
		},

		emailAndPassword: {
			enabled: true,
			requireEmailVerification: true,
		},

		// Sign-up policy (open / bootstrap / invite-only) lives in one place: the
		// user-creation hook runs for every path that makes an account, e-mail +
		// password, OTP sign-in and Google alike. The invite token arrives in the
		// cookie the /sign-up?invite= page sets, which the OAuth callback also
		// carries since it is a top-level navigation back to this origin.
		databaseHooks: {
			user: {
				create: {
					before: async (user, ctx) => {
						const cookie = (ctx?.headers ?? ctx?.request?.headers)?.get(
							"cookie",
						);
						const decision = await evaluateSignup(database, {
							email: user.email,
							inviteToken: readInviteCookie(cookie),
							allowSignup: options.allowSignup,
						});
						if (!decision.allowed) {
							throw new APIError("FORBIDDEN", { message: decision.message });
						}
					},
					after: async (user, ctx) => {
						const cookie = (ctx?.headers ?? ctx?.request?.headers)?.get(
							"cookie",
						);
						const token = readInviteCookie(cookie);
						if (!token) return;
						await consumeInvite(database, token, user.email);
						ctx?.setCookie(INVITE_COOKIE, "", { path: "/", maxAge: 0 });
					},
				},
			},
		},

		socialProviders: {
			google: {
				clientId: env.GOOGLE_CLIENT_ID ?? "",
				clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
				...(env.OAUTH_PROXY_URL
					? {
							redirectURI: `${env.OAUTH_PROXY_URL}/api/auth/callback/google`,
						}
					: {}),
			},
		},

		user: {
			fields: {
				image: "imageUrl",
			},
		},

		plugins: [
			oauthProvider({
				loginPage: "/sign-in",
				consentPage: "/oauth/consent",
				accessTokenExpiresIn: 3600, // 1 hour
				// Native app stays signed in for a year; a revoked/expired refresh
				// token simply sends the user back to the sign-in screen.
				refreshTokenExpiresIn: 31_536_000, // 1 year
				// Dynamic client registration — required for MCP clients (RFC 7591).
				// MCP clients register before any user signs in, so allow it
				// unauthenticated (the plugin then forces public-client auth: none).
				allowDynamicClientRegistration: true,
				allowUnauthenticatedClientRegistration: true,
				scopes: ["openid", "profile", "email", "offline_access"],
				disableJwtPlugin: true, // opaque tokens verified via /oauth2/userinfo
				// MCP clients send `resource=<origin>/api/mcp` (RFC 8707); anything
				// outside this list is rejected with "requested resource invalid".
				validAudiences: [`${getAppUrl()}/api/mcp`, `${getAppUrl()}/api/auth`],
			}),
			apiKey({
				// v1.6.28 renamed the owner column to referenceId; our table keeps
				// the original userId column (uuid FK), so map the field onto it.
				schema: { apikey: { fields: { referenceId: "userId" } } },
				defaultPrefix: "app_",
				requireName: true,
				startingCharactersConfig: {
					shouldStore: true,
					charactersLength: 14,
				},
				keyExpiration: {
					defaultExpiresIn: null,
					disableCustomExpiresTime: false,
					minExpiresIn: 1,
					maxExpiresIn: 3650,
				},
				rateLimit: { enabled: false },
			}),
			twoFactor({
				issuer: "Feed Reader",
				otpOptions: {
					// OTPs in the `verifications` table are hashed at rest — a DB leak
					// doesn't reveal in-flight codes.
					storeOTP: "hashed",
					async sendOTP({ user, otp }) {
						await sendOtpEmail({
							to: user.email,
							subject: "Your 2FA verification code — Feed Reader",
							otp,
							expiresIn: "3 minutes",
						});
					},
				},
			}),
			emailOTP({
				otpLength: 6,
				expiresIn: 600,
				storeOTP: "hashed",
				overrideDefaultEmailVerification: true,
				async sendVerificationOTP({ email, otp, type }) {
					const subjects: Record<string, string> = {
						"sign-in": "Your sign-in code — Feed Reader",
						"email-verification": "Verify your email — Feed Reader",
						"forget-password": "Reset your password — Feed Reader",
					};
					await sendOtpEmail({
						to: email,
						subject: subjects[type] ?? "Your verification code — Feed Reader",
						otp,
						expiresIn: "10 minutes",
					});
				},
			}),

			// OAuth proxy — routes OAuth callbacks through a standalone proxy server
			// for preview/dev deployments. When OAUTH_PROXY_URL is unset, no proxying.
			// `currentURL` pins the dev origin explicitly: without it, the plugin
			// reads the request URL, which under Vite + portless ends up being
			// `127.0.0.1:<random-port>` instead of the configured `<app>.localhost`,
			// so the proxy redirects back to a URL the browser can't trust. Preview
			// deploys leave BETTER_AUTH_URL unset and keep the auto-detection path
			// (each preview gets a unique URL we couldn't pre-configure anyway).
			...(env.OAUTH_PROXY_URL
				? [
						oAuthProxy({
							productionURL: env.OAUTH_PROXY_URL,
							...(env.BETTER_AUTH_URL
								? { currentURL: env.BETTER_AUTH_URL }
								: {}),
						}),
					]
				: []),
		],
	});
}

export const auth = createAuth(db);

export type Auth = typeof auth;
