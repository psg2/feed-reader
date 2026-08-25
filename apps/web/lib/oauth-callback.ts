/**
 * BetterAuth rejects `#fragment` in `callbackURL` (403 INVALID_CALLBACK_URL):
 * its relative-path regex doesn't accept `#`, so any callback fed from
 * `location.href` (or a `?redirect=` param) breaks social login when the URL
 * carries an anchor. The fragment is dropped — RFC 6749 forbids fragments in
 * redirect URIs anyway, and only path+query matter to land the user back.
 */
export function toOAuthCallbackURL(dest: string): string {
	const hashIndex = dest.indexOf("#");
	return hashIndex === -1 ? dest : dest.slice(0, hashIndex);
}

/**
 * Only allow internal paths as redirect targets — blocks open-redirect to
 * external URLs (`https://evil.com`), protocol-relative URLs (`//evil.com`),
 * and the backslash variant browsers normalize to one (`/\evil.com`).
 */
export function safePath(p: string | undefined, fallback = "/reader"): string {
	if (p?.startsWith("/") && !p.startsWith("//") && !p.startsWith("/\\")) {
		return p;
	}
	return fallback;
}

/**
 * When BetterAuth's OAuth provider needs a login it sends the user to
 * /sign-in carrying the signed authorize query (client_id, redirect_uri,
 * scope, … plus ba_* and sig). After signing in we must resume that flow,
 * not land on the reader: rebuild the authorize URL from the original
 * params (dropping the signature envelope) so the provider re-evaluates
 * the request with the fresh session and moves on to consent.
 */
export function oauthResumePath(search: string): string | null {
	const params = new URLSearchParams(search);
	if (!params.get("client_id") || !params.get("sig")) return null;
	for (const key of ["sig", "exp", "ba_iat", "ba_param", "ba_pl"]) {
		params.delete(key);
	}
	return `/api/auth/oauth2/authorize?${params.toString()}`;
}
