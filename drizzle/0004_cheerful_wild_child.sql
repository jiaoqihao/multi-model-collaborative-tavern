CREATE TABLE `story_events` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`event_index` integer NOT NULL,
	`description` text NOT NULL,
	`visible_to` text NOT NULL,
	`visible_to_player` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_story_events_story_turn` ON `story_events` (`story_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_story_events_turn_index` ON `story_events` (`turn_id`,`event_index`);--> statement-breakpoint
CREATE TABLE `story_summary_records` (
	`id` text PRIMARY KEY NOT NULL,
	`story_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`level` text NOT NULL,
	`content` text NOT NULL,
	`source_turn_ids` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_story_summaries_story_turn` ON `story_summary_records` (`story_id`,`turn_id`);--> statement-breakpoint
CREATE TABLE `story_thread_records` (
	`id` text PRIMARY KEY NOT NULL,
	`thread_id` text NOT NULL,
	`story_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`description` text NOT NULL,
	`character_ids` text NOT NULL,
	`status` text NOT NULL,
	`source_event_index` integer,
	`created_at` text NOT NULL,
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`turn_id`) REFERENCES `turns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_story_threads_story_turn` ON `story_thread_records` (`story_id`,`turn_id`);--> statement-breakpoint
CREATE INDEX `idx_story_threads_thread` ON `story_thread_records` (`thread_id`);