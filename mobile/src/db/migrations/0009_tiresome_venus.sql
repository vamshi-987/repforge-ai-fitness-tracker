CREATE TABLE `food_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`log_date` text NOT NULL,
	`meal` text NOT NULL,
	`food_id` text,
	`name` text NOT NULL,
	`brand` text,
	`per_100g` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text NOT NULL,
	`grams` real NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real NOT NULL,
	`carbs_g` real NOT NULL,
	`fat_g` real NOT NULL,
	`fiber_g` real,
	`macros_overridden` integer NOT NULL,
	`kcal_overridden` integer NOT NULL,
	`source` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `food_logs_log_date_idx` ON `food_logs` (`log_date`);--> statement-breakpoint
CREATE INDEX `food_logs_created_at_idx` ON `food_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `foods` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`brand` text,
	`source` text NOT NULL,
	`barcode` text,
	`kcal_100g` real NOT NULL,
	`protein_100g` real NOT NULL,
	`carbs_100g` real NOT NULL,
	`fat_100g` real NOT NULL,
	`fiber_100g` real,
	`servings` text NOT NULL,
	`is_custom` integer NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `foods_barcode_idx` ON `foods` (`barcode`);--> statement-breakpoint
CREATE TABLE `nutrition_targets` (
	`effective_from` text PRIMARY KEY NOT NULL,
	`kcal` integer NOT NULL,
	`protein_g` integer NOT NULL,
	`carbs_g` integer NOT NULL,
	`fat_g` integer NOT NULL,
	`reason` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `saved_meals` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`items` text NOT NULL,
	`version` integer NOT NULL,
	`updated_at` integer NOT NULL
);
