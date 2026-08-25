ALTER TABLE "oauth_access_tokens" ALTER COLUMN "scopes" SET DATA TYPE text[] USING string_to_array("scopes", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ALTER COLUMN "contacts" SET DATA TYPE text[] USING string_to_array("contacts", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ALTER COLUMN "redirect_uris" SET DATA TYPE text[] USING string_to_array("redirect_uris", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ALTER COLUMN "grant_types" SET DATA TYPE text[] USING string_to_array("grant_types", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ALTER COLUMN "response_types" SET DATA TYPE text[] USING string_to_array("response_types", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ALTER COLUMN "scopes" SET DATA TYPE text[] USING string_to_array("scopes", ',');--> statement-breakpoint
ALTER TABLE "oauth_consents" ALTER COLUMN "scopes" SET DATA TYPE text[] USING string_to_array("scopes", ',');--> statement-breakpoint
ALTER TABLE "oauth_refresh_tokens" ALTER COLUMN "scopes" SET DATA TYPE text[] USING string_to_array("scopes", ',');--> statement-breakpoint
ALTER TABLE "oauth_clients" ADD COLUMN "post_logout_redirect_uris" text[];