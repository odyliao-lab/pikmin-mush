CREATE TABLE `retention_backups` (
	`table_name` text NOT NULL,
	`row_key` text NOT NULL,
	`row_json` text NOT NULL,
	`archived_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`batch_id` text NOT NULL,
	PRIMARY KEY(`table_name`, `row_key`)
);
--> statement-breakpoint
CREATE INDEX `retention_backups_expiry_idx` ON `retention_backups` (`expires_at`);--> statement-breakpoint
CREATE INDEX `retention_backups_batch_idx` ON `retention_backups` (`table_name`,`batch_id`);--> statement-breakpoint
CREATE TABLE `retention_table_stats` (
	`table_name` text PRIMARY KEY NOT NULL,
	`row_count` integer,
	`counted_at` integer,
	`previous_row_count` integer,
	`previous_counted_at` integer,
	`eligible_count` integer,
	`oldest_eligible_at` integer,
	`deleted_last_run` integer DEFAULT 0 NOT NULL,
	`checked_at` integer NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`database_bytes` integer
);
--> statement-breakpoint
CREATE INDEX `power_pause_retention_idx` ON `agent_power_pauses` (`resumed_at`,`received_at`);--> statement-breakpoint
CREATE INDEX `scan_agent_events_retention_idx` ON `scan_agent_events` (`at`);--> statement-breakpoint
CREATE INDEX `scan_jobs_finished_idx` ON `scan_jobs` (`finished_at`);--> statement-breakpoint
CREATE INDEX `scan_rotation_runs_job_idx` ON `scan_rotation_runs` (`job_id`);--> statement-breakpoint
CREATE INDEX `scan_target_history_job_idx` ON `scan_target_history` (`job_id`);