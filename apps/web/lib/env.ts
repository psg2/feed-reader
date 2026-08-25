import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

// Dev-only defaults so `pnpm dev` works against a fresh clone with no
// .env.local. Gated on NODE_ENV — production must provide real values
// (enforced below). The literal value of DEV_AUTH_SECRET is intentionally
// obvious so it can never be mistaken for a real secret.
const isProd = process.env.NODE_ENV === "production";
const DEV_AUTH_SECRET = "dev-only-NOT-FOR-PROD-must-be-replaced-32chars";
const DEV_AUTH_URL = "https://feedreader.localhost";

export const env = createEnv({
	shared: {
		NODE_ENV: z
			.enum(["development", "production", "test"])
			.default("development"),
	},
	server: {
		POSTGRES_URL: z.url(),
		// Auth
		BETTER_AUTH_SECRET: isProd
			? z
					.string()
					.min(32, "BETTER_AUTH_SECRET must be at least 32 chars in production")
			: z.string().min(1).default(DEV_AUTH_SECRET),
		BETTER_AUTH_URL: isProd
			? z.url().optional()
			: z.url().default(DEV_AUTH_URL),
		GOOGLE_CLIENT_ID: z.string().optional(),
		GOOGLE_CLIENT_SECRET: z.string().optional(),
		OAUTH_PROXY_URL: z.url().optional(),
		// Email
		RESEND_API_KEY: z.string().optional(),
		/** "Name <address>" used as the From header; the domain must be verified in Resend. */
		EMAIL_FROM: z.string().optional(),
		/** Svix signing secret (whsec_…) of the Resend webhook that delivers `email.received`. */
		RESEND_WEBHOOK_SECRET: z.string().optional(),
		/** Domain whose MX points at Resend; mail to any address there becomes a feed item. */
		INBOUND_EMAIL_DOMAIN: z.string().optional(),
		/**
		 * Comma-separated senders allowed to create newsletter items: full
		 * addresses (`a@b.com`) or domains (`@b.com`). Unset = accept all.
		 */
		INBOUND_ALLOWED_SENDERS: z.string().optional(),
		CRON_SECRET: z.string().optional(),
		/**
		 * Lets feed fetches reach localhost/private addresses (SSRF guard off).
		 * Ignored on the Vercel production deployment — e2e fixtures run on 127.0.0.1.
		 */
		ALLOW_PRIVATE_FEED_HOSTS: z.enum(["true", "false"]).default("false"),
		/**
		 * Sign-up policy. Off by default: the first account can always be
		 * created, after that new users need an invitation from an admin
		 * (Settings › Admin). `true` opens registration to anyone.
		 */
		ALLOW_SIGNUP: z.enum(["true", "false"]).default("false"),
		/**
		 * Comma-separated e-mails of the admins (Settings › Admin: invite and
		 * remove users). Unset = the earliest-created account is the admin.
		 */
		ADMIN_EMAILS: z.string().optional(),
		// Observability
		SENTRY_AUTH_TOKEN: z.string().min(1).optional(),
		SENTRY_ORG: z.string().min(1).optional(),
		SENTRY_PROJECT: z.string().min(1).optional(),
	},
	clientPrefix: "VITE_PUBLIC_",
	client: {
		// Vercel environment, forwarded from process.env.VERCEL_ENV by the
		// build script. Used by client code to gate preview-only affordances
		// (e.g., the demo-credentials hint on the sign-in page).
		VITE_PUBLIC_VERCEL_ENV: z
			.enum(["development", "preview", "production"])
			.optional(),
		VITE_PUBLIC_SENTRY_DSN: z.url().optional(),
		VITE_PUBLIC_POSTHOG_KEY: z.string().min(1).optional(),
		VITE_PUBLIC_POSTHOG_HOST: z.url().optional(),
		VITE_PUBLIC_AXIOM_TOKEN: z.string().min(1).optional(),
		VITE_PUBLIC_AXIOM_DATASET: z.string().min(1).optional(),
	},
	runtimeEnv: {
		NODE_ENV: process.env.NODE_ENV,
		POSTGRES_URL: process.env.POSTGRES_URL,
		BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
		BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
		GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
		GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
		OAUTH_PROXY_URL: process.env.OAUTH_PROXY_URL,
		RESEND_API_KEY: process.env.RESEND_API_KEY,
		EMAIL_FROM: process.env.EMAIL_FROM,
		RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
		INBOUND_EMAIL_DOMAIN: process.env.INBOUND_EMAIL_DOMAIN,
		INBOUND_ALLOWED_SENDERS: process.env.INBOUND_ALLOWED_SENDERS,
		CRON_SECRET: process.env.CRON_SECRET,
		ALLOW_PRIVATE_FEED_HOSTS: process.env.ALLOW_PRIVATE_FEED_HOSTS,
		ALLOW_SIGNUP: process.env.ALLOW_SIGNUP,
		ADMIN_EMAILS: process.env.ADMIN_EMAILS,
		SENTRY_AUTH_TOKEN: process.env.SENTRY_AUTH_TOKEN,
		SENTRY_ORG: process.env.SENTRY_ORG,
		SENTRY_PROJECT: process.env.SENTRY_PROJECT,
		VITE_PUBLIC_VERCEL_ENV: import.meta.env.VITE_PUBLIC_VERCEL_ENV,
		VITE_PUBLIC_SENTRY_DSN: import.meta.env.VITE_PUBLIC_SENTRY_DSN,
		VITE_PUBLIC_POSTHOG_KEY: import.meta.env.VITE_PUBLIC_POSTHOG_KEY,
		VITE_PUBLIC_POSTHOG_HOST: import.meta.env.VITE_PUBLIC_POSTHOG_HOST,
		VITE_PUBLIC_AXIOM_TOKEN: import.meta.env.VITE_PUBLIC_AXIOM_TOKEN,
		VITE_PUBLIC_AXIOM_DATASET: import.meta.env.VITE_PUBLIC_AXIOM_DATASET,
	},
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	emptyStringAsUndefined: true,
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Get the app's public base URL (no trailing slash).
 * In dev, BETTER_AUTH_URL falls back to https://feedreader.localhost via the schema
 * default. Override in .env.local when you change the portless name in
 * apps/web/portless.json (https://<name>.localhost).
 */
export function getAppUrl(): string {
	if (env.BETTER_AUTH_URL) return env.BETTER_AUTH_URL.replace(/\/$/, "");
	if (env.NODE_ENV === "production") {
		throw new Error(
			"BETTER_AUTH_URL is required in production for email links",
		);
	}
	return DEV_AUTH_URL;
}

// ── Production env warnings + dev-secret leak guard ────────────────────────────
// Warn loudly at startup if critical vars are missing in production. The
// dev-default BETTER_AUTH_SECRET is also banned in production — a leaked
// dev secret would let anyone forge session cookies.

if (env.NODE_ENV === "production") {
	if (env.BETTER_AUTH_SECRET === DEV_AUTH_SECRET) {
		throw new Error(
			"[env] ✗ BETTER_AUTH_SECRET is the dev default — refusing to start in production. " +
				"Generate one with `openssl rand -base64 32` and set it in your deploy environment.",
		);
	}
	const required: [string, unknown][] = [
		["RESEND_API_KEY", env.RESEND_API_KEY],
		["BETTER_AUTH_URL", env.BETTER_AUTH_URL],
	];
	const missing = required.filter(([, val]) => !val).map(([name]) => name);
	if (missing.length > 0) {
		console.error(
			`[env] ⚠ Missing required production vars: ${missing.join(", ")}`,
		);
	}
}
