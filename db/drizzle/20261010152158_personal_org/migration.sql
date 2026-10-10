-- Every user gets a personal org with org_id = user.id; a user can now be in many orgs.
ALTER TABLE `org` ADD `kind` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
DROP INDEX IF EXISTS `org_member_user_id_unique`;--> statement-breakpoint
CREATE INDEX `org_member_user_id_idx` ON `org_member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `org_member_org_id_user_id_unique` ON `org_member` (`org_id`,`user_id`);--> statement-breakpoint
-- Orgs made lazily by /subscribe had random ids and no subscriptions: drop them.
DELETE FROM `subscription`;--> statement-breakpoint
DELETE FROM `stripe_customer`;--> statement-breakpoint
DELETE FROM `org_member`;--> statement-breakpoint
DELETE FROM `org`;--> statement-breakpoint
-- org.created_at = user.created_at keeps each trial end unchanged.
INSERT INTO `org` (`org_id`, `name`, `kind`, `created_at`, `updated_at`)
  SELECT `id`, CASE WHEN `name` <> '' THEN `name` ELSE `email` END, 'personal', `created_at`, `created_at` FROM `user`;--> statement-breakpoint
INSERT INTO `org_member` (`org_member_id`, `org_id`, `user_id`, `role`, `created_at`)
  SELECT `id`, `id`, `id`, 'admin', `created_at` FROM `user`;
