CREATE TABLE `body_measurements` (
	`id` text PRIMARY KEY NOT NULL,
	`measured_at` integer NOT NULL,
	`kind` text NOT NULL,
	`value` real NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_measurements_measured_at_idx` ON `body_measurements` (`measured_at`);--> statement-breakpoint
CREATE TABLE `body_weights` (
	`id` text PRIMARY KEY NOT NULL,
	`measured_at` integer NOT NULL,
	`weight_kg` real NOT NULL,
	`source` text NOT NULL,
	`version` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `body_weights_measured_at_idx` ON `body_weights` (`measured_at`);