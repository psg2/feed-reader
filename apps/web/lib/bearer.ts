import { auth } from "./auth";

/**
 * Resolve an `Authorization: Bearer …` token to a user id.
 *
 * Two kinds of bearer are accepted everywhere (oRPC and MCP):
 * - `app_…` API keys (scripts, automation)
 * - OAuth access tokens issued by our own oauth-provider (macOS app, MCP
 *   clients), validated in-process through the userinfo endpoint.
 */
export async function verifyBearer(token: string): Promise<string | null> {
	if (!token) return null;

	if (token.startsWith("app_")) {
		try {
			const result = await auth.api.verifyApiKey({ body: { key: token } });
			if (result.valid && result.key?.referenceId) {
				return result.key.referenceId;
			}
		} catch {
			// fall through
		}
		return null;
	}

	try {
		const info = (await auth.api.oauth2UserInfo({
			headers: new Headers({ authorization: `Bearer ${token}` }),
		})) as { sub?: string };
		return info?.sub ?? null;
	} catch {
		return null;
	}
}
