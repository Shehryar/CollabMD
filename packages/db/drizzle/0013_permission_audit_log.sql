CREATE TABLE `permission_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`action` text NOT NULL,
	`user_ref` text NOT NULL,
	`relation` text NOT NULL,
	`object_ref` text NOT NULL,
	`actor_id` text,
	`source` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pal_object` ON `permission_audit_log` (`object_ref`);
--> statement-breakpoint
CREATE INDEX `idx_pal_user` ON `permission_audit_log` (`user_ref`);
--> statement-breakpoint
CREATE INDEX `idx_pal_created` ON `permission_audit_log` (`created_at`);
