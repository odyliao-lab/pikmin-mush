CREATE INDEX `mushrooms_last_seen_id_idx` ON `mushrooms` (`last_seen`,`id`);
--> statement-breakpoint
CREATE TABLE `maintenance_state` (
	`name` text PRIMARY KEY NOT NULL,
	`last_run_at` integer DEFAULT 0 NOT NULL,
	`last_deleted` integer DEFAULT 0 NOT NULL,
	`pending` integer DEFAULT 0 NOT NULL
);
