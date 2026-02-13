PRAGMA foreign_keys=OFF;
--> statement-breakpoint
CREATE TABLE `folders__new` (
  `id` text PRIMARY KEY NOT NULL,
  `org_id` text NOT NULL,
  `name` text NOT NULL,
  `path` text NOT NULL,
  `parent_id` text,
  `created_by` text NOT NULL,
  `created_at` integer NOT NULL,
  FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`parent_id`) REFERENCES `folders__new`(`id`) ON UPDATE no action ON DELETE cascade,
  FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `folders__new` (`id`, `org_id`, `name`, `path`, `parent_id`, `created_by`, `created_at`)
SELECT `id`, `org_id`, `name`, `path`, `parent_id`, `created_by`, `created_at`
FROM `folders`;
--> statement-breakpoint
DROP TABLE `folders`;
--> statement-breakpoint
ALTER TABLE `folders__new` RENAME TO `folders`;
--> statement-breakpoint
CREATE TABLE `documents__new` (
  `id` text PRIMARY KEY NOT NULL,
  `title` text NOT NULL,
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
INSERT INTO `documents__new` (`id`, `title`, `org_id`, `owner_id`, `folder_id`, `is_public`, `agent_editable`, `deleted_at`, `created_at`, `updated_at`)
SELECT `id`, `title`, `org_id`, `owner_id`, `folder_id`, `is_public`, `agent_editable`, `deleted_at`, `created_at`, `updated_at`
FROM `documents`;
--> statement-breakpoint
DROP TABLE `documents`;
--> statement-breakpoint
ALTER TABLE `documents__new` RENAME TO `documents`;
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
PRAGMA foreign_keys=ON;
