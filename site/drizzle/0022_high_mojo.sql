ALTER TABLE `scan_target_history` ADD `verification_batch` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `verification_mushroom_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `status` text DEFAULT 'cancelled' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `leased_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `completed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `completed_agent_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `lat` real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_target_history` ADD `lng` real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `scan_target_history_verification_idx` ON `scan_target_history` (`verification_batch`);