CREATE TABLE `user_notification_preferences` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email_notifications` text DEFAULT 'all' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `user_notification_preferences_email_notifications_idx` ON `user_notification_preferences` (`email_notifications`);