ALTER TABLE "app_setting" DROP CONSTRAINT "app_setting_updated_by_user_account_id_fk";
--> statement-breakpoint
ALTER TABLE "app_setting" DROP COLUMN "updated_by";