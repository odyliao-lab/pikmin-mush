CREATE TABLE `agent_state` (
	`id` integer PRIMARY KEY NOT NULL,
	`seq` integer DEFAULT 0 NOT NULL,
	`command_op` text DEFAULT 'wait' NOT NULL,
	`command_arg1` text DEFAULT '' NOT NULL,
	`command_arg2` text DEFAULT '' NOT NULL,
	`ack_seq` integer DEFAULT 0 NOT NULL,
	`ack_ok` integer DEFAULT 0 NOT NULL,
	`ack_message` text DEFAULT '' NOT NULL,
	`last_seen` integer DEFAULT 0 NOT NULL,
	`current_lat` real,
	`current_lng` real,
	`uploaded_rows` integer DEFAULT 0 NOT NULL,
	`uploaded_bytes` integer DEFAULT 0 NOT NULL,
	`partial_text` text DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mushrooms` (
	`id` text PRIMARY KEY NOT NULL,
	`lat` real NOT NULL,
	`lng` real NOT NULL,
	`level` integer DEFAULT 0 NOT NULL,
	`type` integer DEFAULT 0 NOT NULL,
	`cluster` text DEFAULT '' NOT NULL,
	`cooldown` integer DEFAULT 0 NOT NULL,
	`finish_ms` integer DEFAULT 0 NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL,
	`challenger_count` integer DEFAULT 0 NOT NULL,
	`challenger_capacity` integer DEFAULT 0 NOT NULL,
	`total_power` real DEFAULT 0 NOT NULL,
	`start_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `scanner_status` (
	`id` integer PRIMARY KEY NOT NULL,
	`status_json` text DEFAULT '{}' NOT NULL,
	`updated_at` integer DEFAULT 0 NOT NULL
);
