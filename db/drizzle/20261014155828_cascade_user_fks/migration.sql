-- Cascade deletes from user (api keys, OAuth tokens, consents) and from refresh token to its
-- access tokens. SQLite cannot alter a FOREIGN KEY, so each table is rebuilt.
-- D1 runs a migration in one transaction and ignores PRAGMA foreign_keys, so FK checks are
-- deferred to COMMIT. Dropping a table that still has child rows leaves a deferred violation
-- that never clears, so access tokens are stashed and dropped before oauth_refresh_token.
PRAGMA defer_foreign_keys = on;--> statement-breakpoint
CREATE TABLE `__old_oauth_access_token` AS SELECT * FROM `oauth_access_token`;--> statement-breakpoint
DROP TABLE `oauth_access_token`;--> statement-breakpoint
CREATE TABLE `__new_oauth_refresh_token` (
	`id` text PRIMARY KEY,
	`token` text NOT NULL UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text NOT NULL,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`rotated_at` integer,
	`rotation_replay_response` text,
	`rotation_replay_expires_at` integer,
	`auth_time` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_refresh_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`),
	CONSTRAINT `fk_oauth_refresh_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_refresh_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_oauth_refresh_token`(`id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`, `authorization_code_id`, `resources`, `requested_user_info_claims`, `expires_at`, `created_at`, `revoked`, `rotated_at`, `rotation_replay_response`, `rotation_replay_expires_at`, `auth_time`, `confirmation`, `scopes`) SELECT `id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`, `authorization_code_id`, `resources`, `requested_user_info_claims`, `expires_at`, `created_at`, `revoked`, `rotated_at`, `rotation_replay_response`, `rotation_replay_expires_at`, `auth_time`, `confirmation`, `scopes` FROM `oauth_refresh_token`;--> statement-breakpoint
DROP TABLE `oauth_refresh_token`;--> statement-breakpoint
ALTER TABLE `__new_oauth_refresh_token` RENAME TO `oauth_refresh_token`;--> statement-breakpoint
CREATE TABLE `oauth_access_token` (
	`id` text PRIMARY KEY,
	`token` text UNIQUE,
	`client_id` text NOT NULL,
	`session_id` text,
	`user_id` text,
	`reference_id` text,
	`authorization_code_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`refresh_id` text,
	`expires_at` integer,
	`created_at` integer,
	`revoked` integer,
	`confirmation` text,
	`scopes` text NOT NULL,
	CONSTRAINT `fk_oauth_access_token_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`),
	CONSTRAINT `fk_oauth_access_token_session_id_session_id_fk` FOREIGN KEY (`session_id`) REFERENCES `session`(`id`) ON DELETE SET NULL,
	CONSTRAINT `fk_oauth_access_token_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE,
	CONSTRAINT `fk_oauth_access_token_refresh_id_oauth_refresh_token_id_fk` FOREIGN KEY (`refresh_id`) REFERENCES `oauth_refresh_token`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `oauth_access_token`(`id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`, `authorization_code_id`, `resources`, `requested_user_info_claims`, `refresh_id`, `expires_at`, `created_at`, `revoked`, `confirmation`, `scopes`) SELECT `id`, `token`, `client_id`, `session_id`, `user_id`, `reference_id`, `authorization_code_id`, `resources`, `requested_user_info_claims`, `refresh_id`, `expires_at`, `created_at`, `revoked`, `confirmation`, `scopes` FROM `__old_oauth_access_token`;--> statement-breakpoint
DROP TABLE `__old_oauth_access_token`;--> statement-breakpoint
CREATE TABLE `__new_oauth_consent` (
	`id` text PRIMARY KEY,
	`client_id` text NOT NULL,
	`user_id` text,
	`reference_id` text,
	`resources` text,
	`requested_user_info_claims` text,
	`scopes` text NOT NULL,
	`created_at` integer,
	`updated_at` integer,
	CONSTRAINT `fk_oauth_consent_client_id_oauth_client_client_id_fk` FOREIGN KEY (`client_id`) REFERENCES `oauth_client`(`client_id`),
	CONSTRAINT `fk_oauth_consent_user_id_user_id_fk` FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_oauth_consent`(`id`, `client_id`, `user_id`, `reference_id`, `resources`, `requested_user_info_claims`, `scopes`, `created_at`, `updated_at`) SELECT `id`, `client_id`, `user_id`, `reference_id`, `resources`, `requested_user_info_claims`, `scopes`, `created_at`, `updated_at` FROM `oauth_consent`;--> statement-breakpoint
DROP TABLE `oauth_consent`;--> statement-breakpoint
ALTER TABLE `__new_oauth_consent` RENAME TO `oauth_consent`;--> statement-breakpoint
CREATE TABLE `__new_apikey` (
	`id` text PRIMARY KEY,
	`config_id` text DEFAULT 'default' NOT NULL,
	`name` text,
	`start` text,
	`reference_id` text NOT NULL,
	`prefix` text,
	`key` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer DEFAULT true,
	`rate_limit_enabled` integer DEFAULT true,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer DEFAULT 0,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	CONSTRAINT `fk_apikey_reference_id_user_id_fk` FOREIGN KEY (`reference_id`) REFERENCES `user`(`id`) ON DELETE CASCADE
);
--> statement-breakpoint
INSERT INTO `__new_apikey`(`id`, `config_id`, `name`, `start`, `reference_id`, `prefix`, `key`, `refill_interval`, `refill_amount`, `last_refill_at`, `enabled`, `rate_limit_enabled`, `rate_limit_time_window`, `rate_limit_max`, `request_count`, `remaining`, `last_request`, `expires_at`, `created_at`, `updated_at`, `permissions`, `metadata`) SELECT `id`, `config_id`, `name`, `start`, `reference_id`, `prefix`, `key`, `refill_interval`, `refill_amount`, `last_refill_at`, `enabled`, `rate_limit_enabled`, `rate_limit_time_window`, `rate_limit_max`, `request_count`, `remaining`, `last_request`, `expires_at`, `created_at`, `updated_at`, `permissions`, `metadata` FROM `apikey`;--> statement-breakpoint
DROP TABLE `apikey`;--> statement-breakpoint
ALTER TABLE `__new_apikey` RENAME TO `apikey`;--> statement-breakpoint
CREATE INDEX `apikey_config_id_idx` ON `apikey` (`config_id`);--> statement-breakpoint
CREATE INDEX `apikey_reference_id_idx` ON `apikey` (`reference_id`);--> statement-breakpoint
CREATE INDEX `apikey_key_idx` ON `apikey` (`key`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_client_id_idx` ON `oauth_access_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_session_id_idx` ON `oauth_access_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_user_id_idx` ON `oauth_access_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_authorization_code_id_idx` ON `oauth_access_token` (`authorization_code_id`);--> statement-breakpoint
CREATE INDEX `oauth_access_token_refresh_id_idx` ON `oauth_access_token` (`refresh_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_client_id_idx` ON `oauth_consent` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_consent_user_id_idx` ON `oauth_consent` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_client_id_idx` ON `oauth_refresh_token` (`client_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_session_id_idx` ON `oauth_refresh_token` (`session_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_user_id_idx` ON `oauth_refresh_token` (`user_id`);--> statement-breakpoint
CREATE INDEX `oauth_refresh_token_authorization_code_id_idx` ON `oauth_refresh_token` (`authorization_code_id`);