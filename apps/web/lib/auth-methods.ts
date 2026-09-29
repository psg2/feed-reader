/**
 * Which sign-in methods this deployment can actually serve.
 *
 * `lib/auth.ts` registers providers from this, and the auth pages render
 * options from it, so the UI never offers a method the server would reject.
 * Only booleans leave the server — never IDs or secrets.
 */
export interface AuthMethods {
	passwordSignIn: boolean;
	/** Sign-up requires email verification, so it needs email delivery. */
	passwordSignUp: boolean;
	passwordReset: boolean;
	emailOtp: boolean;
	google: boolean;
}

interface AuthMethodsEnv {
	NODE_ENV?: string;
	RESEND_API_KEY?: string;
	EMAIL_FROM?: string;
	GOOGLE_CLIENT_ID?: string;
	GOOGLE_CLIENT_SECRET?: string;
}

export function googleCredentials(
	source: AuthMethodsEnv,
): { clientId: string; clientSecret: string } | null {
	const clientId = source.GOOGLE_CLIENT_ID?.trim();
	const clientSecret = source.GOOGLE_CLIENT_SECRET?.trim();
	if (!clientId || !clientSecret) return null;
	return { clientId, clientSecret };
}

/** Resend refuses a From address outside a verified domain, so both are needed. */
export function isEmailProviderConfigured(source: AuthMethodsEnv): boolean {
	return !!source.RESEND_API_KEY?.trim() && !!source.EMAIL_FROM?.trim();
}

/**
 * Outside production, `lib/email.ts` prints emails to the console, which is
 * enough to read a code locally. In production (Vercel previews included)
 * only a real provider delivers them.
 */
export function canDeliverEmail(source: AuthMethodsEnv): boolean {
	return source.NODE_ENV !== "production" || isEmailProviderConfigured(source);
}

export function resolveAuthMethods(source: AuthMethodsEnv): AuthMethods {
	const email = canDeliverEmail(source);
	return {
		passwordSignIn: true,
		passwordSignUp: email,
		passwordReset: email,
		emailOtp: email,
		google: googleCredentials(source) !== null,
	};
}
