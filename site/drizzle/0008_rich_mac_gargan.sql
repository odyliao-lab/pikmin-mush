ALTER TABLE `scan_targets` ADD `priority` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `required_agent_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `verification_batch` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `verification_mushroom_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `verification_kind` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `scan_targets_verification_idx` ON `scan_targets` (`verification_batch`,`verification_kind`,`status`);