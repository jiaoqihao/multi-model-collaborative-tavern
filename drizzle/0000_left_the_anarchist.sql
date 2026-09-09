CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`data` text NOT NULL,
	`encrypted_key` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_profiles_owner` ON `profiles` (`owner`);--> statement-breakpoint
CREATE TABLE `stories` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`title` text NOT NULL,
	`data` text NOT NULL,
	`root` text NOT NULL,
	`head_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	`demo` integer DEFAULT 1 NOT NULL,
	`director_id` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_stories_owner_created` ON `stories` (`owner`,`created_at`);--> statement-breakpoint
CREATE TABLE `turns` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`parent_id` text,
	`data` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_turns_story_created` ON `turns` (`story_id`,`created_at`);