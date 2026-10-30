CREATE TABLE `controller_return_recoveries` (
	`batch` text PRIMARY KEY NOT NULL,
	`recovery_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`original_job_id` integer NOT NULL,
	`job_id` integer NOT NULL,
	`original_return_target_id` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `controller_return_recoveries_recovery_id_unique` ON `controller_return_recoveries` (`recovery_id`);