CREATE TABLE `memory_vectors` (
	`owner` text NOT NULL,
	`story_id` text NOT NULL,
	`character_id` text NOT NULL,
	`model_key` text NOT NULL,
	`memory_id` text NOT NULL,
	`turn_id` text NOT NULL,
	`content_hash` text NOT NULL,
	`dimensions` integer NOT NULL,
	`vector` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`owner`, `story_id`, `character_id`, `model_key`, `memory_id`),
	FOREIGN KEY (`story_id`) REFERENCES `stories`(`id`) ON UPDATE no action ON DELETE no action
);
