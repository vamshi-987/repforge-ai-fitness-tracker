CREATE TABLE `outbox` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`op` text NOT NULL,
	`data` text,
	`base_version` integer,
	`updated_at` integer NOT NULL,
	`revision` integer NOT NULL,
	`attempts` integer NOT NULL,
	`next_try_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_entity_row_idx` ON `outbox` (`entity`,`entity_id`);--> statement-breakpoint
ALTER TABLE `workouts` ADD `version` integer DEFAULT 0 NOT NULL;