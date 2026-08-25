-- First-party OAuth client for the macOS app (public client, PKCE, custom
-- scheme redirect). skip_consent: it is our own app, no consent screen.
INSERT INTO "oauth_clients" (
	"client_id", "name", "redirect_uris", "token_endpoint_auth_method",
	"grant_types", "response_types", "scopes", "type", "public",
	"skip_consent", "require_pkce"
) VALUES (
	'feedreader-macos', 'Feed Reader for macOS',
	'{feedreader://oauth/callback}', 'none',
	'{authorization_code,refresh_token}', '{code}',
	'{openid,profile,email,offline_access}', 'native', true,
	true, true
) ON CONFLICT ("client_id") DO NOTHING;
