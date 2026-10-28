CREATE TABLE `history_retention_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`expires_at` integer NOT NULL,
	`last_started_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_targets_retention_idx` ON `scan_targets` (`updated_at`,`id`) WHERE status IN ('completed','failed','cancelled');