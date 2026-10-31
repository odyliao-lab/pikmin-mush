DROP INDEX `controller_one_active_dispatch`;--> statement-breakpoint
ALTER TABLE `controller_dispatches` ADD `parallel_mode` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `controller_agent_active_dispatch` ON `controller_dispatches` (`agent_id`) WHERE "controller_dispatches"."state"='active';