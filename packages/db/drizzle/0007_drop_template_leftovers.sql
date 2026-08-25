DROP TABLE "auth_waitlist_config" CASCADE;--> statement-breakpoint
DROP TABLE "auth_waitlist" CASCADE;--> statement-breakpoint
ALTER TABLE "auth_sessions" DROP COLUMN "impersonated_by";--> statement-breakpoint
ALTER TABLE "auth_users" DROP COLUMN "role";--> statement-breakpoint
ALTER TABLE "auth_users" DROP COLUMN "banned";--> statement-breakpoint
ALTER TABLE "auth_users" DROP COLUMN "ban_reason";--> statement-breakpoint
ALTER TABLE "auth_users" DROP COLUMN "ban_expires";