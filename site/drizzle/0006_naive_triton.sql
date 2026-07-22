CREATE TABLE `scan_rotation_runs` (
	`schedule_date` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`job_id` integer,
	`assignments_json` text DEFAULT '[]' NOT NULL,
	`message` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_rotation_runs_updated_at_idx` ON `scan_rotation_runs` (`updated_at`);--> statement-breakpoint
CREATE TABLE `scan_rotation_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`timezone` text DEFAULT 'Asia/Taipei' NOT NULL,
	`switch_minute` integer DEFAULT 450 NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
