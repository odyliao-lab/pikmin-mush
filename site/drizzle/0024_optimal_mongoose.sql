CREATE TABLE `public_read_budgets` (
	`source` text PRIMARY KEY NOT NULL,
	`window` integer NOT NULL,
	`requests` integer NOT NULL,
	`spatial` integer NOT NULL,
	`last_bbox` text NOT NULL,
	`leases` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `public_read_budgets_updated_idx` ON `public_read_budgets` (`updated_at`);