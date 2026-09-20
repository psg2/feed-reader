DROP INDEX "account_issuer_account_id_uidx";--> statement-breakpoint
ALTER TABLE "auth_accounts" DROP COLUMN "issuer";