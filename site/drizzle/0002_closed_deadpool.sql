CREATE TABLE `scan_jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`config_json` text NOT NULL,
	`plan_json` text NOT NULL,
	`total_points` integer NOT NULL,
	`current_index` integer DEFAULT 0 NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`loop` integer DEFAULT 0 NOT NULL,
	`captured_rows` integer DEFAULT 0 NOT NULL,
	`captured_bytes` integer DEFAULT 0 NOT NULL,
	`current_country` text DEFAULT '' NOT NULL,
	`current_city` text DEFAULT '' NOT NULL,
	`current_lat` real,
	`current_lng` real,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`started_at` integer DEFAULT 0 NOT NULL,
	`finished_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_jobs_status_idx` ON `scan_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `scan_jobs_updated_at_idx` ON `scan_jobs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `scan_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`at` integer NOT NULL,
	`level` text DEFAULT 'info' NOT NULL,
	`message` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_logs_job_at_idx` ON `scan_logs` (`job_id`,`at`);