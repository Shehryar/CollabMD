CREATE TABLE `pending_resource_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`resource_type` text NOT NULL,
	`resource_id` text NOT NULL,
	`org_id` text NOT NULL,
	`role` text NOT NULL,
	`inviter_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`org_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`inviter_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `pending_resource_invites_email_idx` ON `pending_resource_invites` (`email`);
--> statement-breakpoint
CREATE INDEX `pending_resource_invites_resource_idx` ON `pending_resource_invites` (`resource_type`,`resource_id`);
--> statement-breakpoint
CREATE INDEX `pending_resource_invites_inviter_id_idx` ON `pending_resource_invites` (`inviter_id`);
