CREATE TABLE `controller_dispatches` (
	`batch` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`payload_sha` text NOT NULL,
	`admission` text NOT NULL,
	`agent_id` text NOT NULL,
	`job_id` integer NOT NULL,
	`candidate_count` integer NOT NULL,
	`state` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`closed_at` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `controller_dispatches_admission_unique` ON `controller_dispatches` (`admission`);--> statement-breakpoint
CREATE UNIQUE INDEX `controller_one_active_dispatch` ON `controller_dispatches` (`state`) WHERE "controller_dispatches"."state"='active';