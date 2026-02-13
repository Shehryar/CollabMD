ALTER TABLE `documents` ADD COLUMN `agent_editable` integer DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jwks` (
  `id` text PRIMARY KEY NOT NULL,
  `public_key` text NOT NULL,
  `private_key` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `members_org_user_unique` ON `members` (`organization_id`, `user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `accounts_user_id_idx` ON `accounts` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_user_id_idx` ON `sessions` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invitations_org_id_idx` ON `invitations` (`organization_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `invitations_inviter_id_idx` ON `invitations` (`inviter_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `members_org_id_idx` ON `members` (`organization_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `members_user_id_idx` ON `members` (`user_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folders_org_id_idx` ON `folders` (`org_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folders_parent_id_idx` ON `folders` (`parent_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `folders_created_by_idx` ON `folders` (`created_by`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_org_id_idx` ON `documents` (`org_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_owner_id_idx` ON `documents` (`owner_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_folder_id_idx` ON `documents` (`folder_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `documents_deleted_at_idx` ON `documents` (`deleted_at`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_snapshots_document_id_idx` ON `document_snapshots` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_snapshots_created_by_idx` ON `document_snapshots` (`created_by`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `share_links_document_id_idx` ON `share_links` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `share_links_created_by_idx` ON `share_links` (`created_by`);
