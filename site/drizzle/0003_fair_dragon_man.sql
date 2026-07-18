CREATE TABLE `scan_agents` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`token_hash` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`region_tags_json` text DEFAULT '[]' NOT NULL,
	`capabilities_json` text DEFAULT '{}' NOT NULL,
	`agent_version` text DEFAULT '' NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`current_lat` real,
	`current_lng` real,
	`current_job_id` integer,
	`current_target_id` integer,
	`uploaded_rows` integer DEFAULT 0 NOT NULL,
	`uploaded_bytes` integer DEFAULT 0 NOT NULL,
	`partial_text` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_agents_last_seen_idx` ON `scan_agents` (`last_seen`);--> statement-breakpoint
CREATE TABLE `scan_targets` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`job_id` integer NOT NULL,
	`sequence` integer NOT NULL,
	`cycle` integer DEFAULT 0 NOT NULL,
	`country` text DEFAULT '' NOT NULL,
	`city` text NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`region_index` integer DEFAULT 0 NOT NULL,
	`point_index` integer DEFAULT 0 NOT NULL,
	`base_cooldown_s` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`lease_agent_id` text DEFAULT '' NOT NULL,
	`lease_token` text DEFAULT '' NOT NULL,
	`lease_expires_at` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`captured_rows` integer DEFAULT 0 NOT NULL,
	`captured_bytes` integer DEFAULT 0 NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_targets_claim_idx` ON `scan_targets` (`job_id`,`status`,`cycle`);--> statement-breakpoint
CREATE INDEX `scan_targets_lease_idx` ON `scan_targets` (`lease_expires_at`);--> statement-breakpoint
CREATE INDEX `scan_targets_agent_idx` ON `scan_targets` (`lease_agent_id`,`status`);