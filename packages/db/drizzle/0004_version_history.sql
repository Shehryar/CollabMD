CREATE TABLE IF NOT EXISTS `document_snapshots` (
  `id` text PRIMARY KEY NOT NULL,
  `document_id` text NOT NULL REFERENCES `documents`(`id`) ON DELETE CASCADE,
  `snapshot` blob NOT NULL,
  `created_at` integer NOT NULL,
  `created_by` text REFERENCES `users`(`id`),
  `is_agent_edit` integer NOT NULL DEFAULT 0,
  `label` text
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_snapshots_document_id_idx` ON `document_snapshots` (`document_id`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `document_snapshots_created_by_idx` ON `document_snapshots` (`created_by`);
