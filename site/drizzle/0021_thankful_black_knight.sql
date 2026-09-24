ALTER TABLE `maintenance_state` ADD `last_succeeded_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_failed_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_failure_stage` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `consecutive_failures` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_duration_ms` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_invalidated` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_observations_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_targets_deleted` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `maintenance_state` ADD `last_batch_saturated` integer DEFAULT 0 NOT NULL;