CREATE TABLE `generation_stages` (
	`request_id` text NOT NULL,
	`stage_key` text NOT NULL,
	`story_id` text NOT NULL,
	`owner` text NOT NULL,
	`fingerprint` text NOT NULL,
	`data` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`request_id`, `stage_key`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_generation_stages_story_owner` ON `generation_stages` (`story_id`,`owner`);