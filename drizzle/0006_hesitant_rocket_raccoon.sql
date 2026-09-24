CREATE TABLE `vector_connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`encrypted_key` text NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_vector_connections_owner` ON `vector_connections` (`owner`);