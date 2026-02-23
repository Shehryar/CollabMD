CREATE TABLE `agent_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`key_hash` text NOT NULL,
	`key_prefix` text NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`scopes` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_keys_key_hash_unique` ON `agent_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `agent_keys_org_id_idx` ON `agent_keys` (`org_id`);--> statement-breakpoint
CREATE INDEX `agent_keys_key_hash_idx` ON `agent_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `agent_keys_created_by_idx` ON `agent_keys` (`created_by`);--> statement-breakpoint
CREATE INDEX `agent_keys_revoked_at_idx` ON `agent_keys` (`revoked_at`);--> statement-breakpoint
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`webhook_id` text NOT NULL,
	`event_type` text NOT NULL,
	`payload` text NOT NULL,
	`status_code` integer,
	`response_body` text,
	`attempt_count` integer DEFAULT 1 NOT NULL,
	`last_attempt_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`webhook_id`) REFERENCES `webhooks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhook_deliveries_webhook_id_idx` ON `webhook_deliveries` (`webhook_id`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_event_type_idx` ON `webhook_deliveries` (`event_type`);--> statement-breakpoint
CREATE INDEX `webhook_deliveries_created_at_idx` ON `webhook_deliveries` (`created_at`);--> statement-breakpoint
CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`url` text NOT NULL,
	`secret` text NOT NULL,
	`events` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `webhooks_org_id_idx` ON `webhooks` (`org_id`);--> statement-breakpoint
CREATE INDEX `webhooks_created_by_idx` ON `webhooks` (`created_by`);--> statement-breakpoint
CREATE INDEX `webhooks_active_idx` ON `webhooks` (`active`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`source` text DEFAULT 'web',
	`org_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`folder_id` text,
	`is_public` integer DEFAULT false NOT NULL,
	`agent_editable` integer DEFAULT true NOT NULL,
	`deleted_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`folder_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_documents`("id", "title", "source", "org_id", "owner_id", "folder_id", "is_public", "agent_editable", "deleted_at", "created_at", "updated_at") SELECT "id", "title", "source", "org_id", "owner_id", "folder_id", "is_public", "agent_editable", "deleted_at", "created_at", "updated_at" FROM `documents`;--> statement-breakpoint
DROP TABLE `documents`;--> statement-breakpoint
ALTER TABLE `__new_documents` RENAME TO `documents`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `documents_org_id_idx` ON `documents` (`org_id`);--> statement-breakpoint
CREATE INDEX `documents_owner_id_idx` ON `documents` (`owner_id`);--> statement-breakpoint
CREATE INDEX `documents_folder_id_idx` ON `documents` (`folder_id`);--> statement-breakpoint
CREATE INDEX `documents_deleted_at_idx` ON `documents` (`deleted_at`);--> statement-breakpoint
CREATE TABLE `__new_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`org_id` text NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`parent_id` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `folders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_folders`("id", "org_id", "name", "path", "parent_id", "created_by", "created_at") SELECT "id", "org_id", "name", "path", "parent_id", "created_by", "created_at" FROM `folders`;--> statement-breakpoint
DROP TABLE `folders`;--> statement-breakpoint
ALTER TABLE `__new_folders` RENAME TO `folders`;--> statement-breakpoint
CREATE INDEX `folders_org_id_idx` ON `folders` (`org_id`);--> statement-breakpoint
CREATE INDEX `folders_parent_id_idx` ON `folders` (`parent_id`);--> statement-breakpoint
CREATE INDEX `folders_created_by_idx` ON `folders` (`created_by`);--> statement-breakpoint
ALTER TABLE `sessions` ADD `active_organization_id` text REFERENCES organizations(id);--> statement-breakpoint
CREATE INDEX `sessions_user_id_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_active_org_id_idx` ON `sessions` (`active_organization_id`);--> statement-breakpoint
CREATE INDEX `accounts_user_id_idx` ON `accounts` (`user_id`);--> statement-breakpoint
CREATE INDEX `document_snapshots_document_id_idx` ON `document_snapshots` (`document_id`);--> statement-breakpoint
CREATE INDEX `document_snapshots_created_by_idx` ON `document_snapshots` (`created_by`);--> statement-breakpoint
CREATE INDEX `invitations_org_id_idx` ON `invitations` (`organization_id`);--> statement-breakpoint
CREATE INDEX `invitations_inviter_id_idx` ON `invitations` (`inviter_id`);--> statement-breakpoint
CREATE INDEX `members_org_id_idx` ON `members` (`organization_id`);--> statement-breakpoint
CREATE INDEX `members_user_id_idx` ON `members` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `members_org_user_unique` ON `members` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `share_links_document_id_idx` ON `share_links` (`document_id`);--> statement-breakpoint
CREATE INDEX `share_links_created_by_idx` ON `share_links` (`created_by`);