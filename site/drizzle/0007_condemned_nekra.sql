CREATE TABLE `scan_agent_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`agent_id` text NOT NULL,
	`event_type` text NOT NULL,
	`at` integer NOT NULL,
	`job_id` integer,
	`target_id` integer,
	`rows` integer DEFAULT 0 NOT NULL,
	`bytes` integer DEFAULT 0 NOT NULL,
	`duration_ms` integer DEFAULT 0 NOT NULL,
	`detail` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_agent_events_agent_at_idx` ON `scan_agent_events` (`agent_id`,`at`);--> statement-breakpoint
CREATE INDEX `scan_agent_events_type_at_idx` ON `scan_agent_events` (`event_type`,`at`);--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `game_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `module_version` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `last_data_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `last_target_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `no_data_streak` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `previous_token_hash` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `previous_token_expires_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_agents` ADD `token_rotated_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `leased_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `scan_targets` ADD `completed_agent_id` text DEFAULT '' NOT NULL;