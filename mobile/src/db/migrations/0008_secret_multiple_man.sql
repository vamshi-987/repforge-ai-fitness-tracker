CREATE TABLE `water_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`logged_at` integer NOT NULL,
	`amount_ml` integer NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `water_logs_logged_at_idx` ON `water_logs` (`logged_at`);