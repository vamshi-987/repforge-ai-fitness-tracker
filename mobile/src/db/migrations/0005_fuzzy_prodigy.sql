CREATE TABLE `personal_records` (
	`id` text PRIMARY KEY NOT NULL,
	`exercise_id` text NOT NULL,
	`record_type` text NOT NULL,
	`value` real NOT NULL,
	`workout_id` text NOT NULL,
	`workout_set_id` text,
	`previous_value` real,
	`achieved_at` integer NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `personal_records_exercise_id_idx` ON `personal_records` (`exercise_id`,`record_type`);--> statement-breakpoint
CREATE INDEX `personal_records_workout_id_idx` ON `personal_records` (`workout_id`);--> statement-breakpoint
CREATE TABLE `workout_muscle_sets` (
	`workout_id` text NOT NULL,
	`muscle` text NOT NULL,
	`sets` real NOT NULL,
	PRIMARY KEY(`workout_id`, `muscle`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade
);
