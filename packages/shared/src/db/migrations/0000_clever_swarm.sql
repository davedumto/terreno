CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`telegram_chat_id` text NOT NULL,
	`telegram_message_id` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_task_worker_idx` ON `notifications` (`task_id`,`worker_id`);--> statement-breakpoint
CREATE TABLE `ratings` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`score` integer NOT NULL,
	`comment` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "ratings_score_check" CHECK("ratings"."score" between 1 and 5)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ratings_task_id_unique` ON `ratings` (`task_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`answer` text NOT NULL,
	`photo_key` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_task_id_unique` ON `submissions` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_events_kind_check" CHECK("task_events"."kind" in ('paid', 'escrowed', 'notified', 'claimed', 'claim_expired', 'submitted', 'released', 'refunded', 'policy_rejected', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `task_events_task_id_idx` ON `task_events` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`status` text NOT NULL,
	`input` text NOT NULL,
	`country` text NOT NULL,
	`city` text NOT NULL,
	`price` integer NOT NULL,
	`fee` integer NOT NULL,
	`payer_address` text NOT NULL,
	`payment_tx_hash` text NOT NULL,
	`escrow_tx_hash` text,
	`worker_id` text,
	`claimed_at` integer,
	`submitted_at` integer,
	`claim_expires_at` integer,
	`deadline_at` integer NOT NULL,
	`release_tx_hash` text,
	`refund_tx_hash` text,
	`task_token_hash` text NOT NULL,
	`callback_url` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_type_check" CHECK("tasks"."type" in ('verify_place', 'check_price', 'translate')),
	CONSTRAINT "tasks_status_check" CHECK("tasks"."status" in ('paid', 'open', 'claimed', 'submitted', 'completed', 'refunded'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_payment_tx_hash_unique` ON `tasks` (`payment_tx_hash`);--> statement-breakpoint
CREATE INDEX `tasks_status_country_city_idx` ON `tasks` (`status`,`country`,`city`);--> statement-breakpoint
CREATE INDEX `tasks_status_deadline_at_idx` ON `tasks` (`status`,`deadline_at`);--> statement-breakpoint
CREATE INDEX `tasks_status_claim_expires_at_idx` ON `tasks` (`status`,`claim_expires_at`);--> statement-breakpoint
CREATE TABLE `telegram_links` (
	`code` text PRIMARY KEY NOT NULL,
	`worker_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`worker_id`) REFERENCES `workers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `workers` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`wallet_address` text NOT NULL,
	`passkey_credential_id` text NOT NULL,
	`telegram_chat_id` text,
	`country` text NOT NULL,
	`city` text NOT NULL,
	`languages` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "workers_status_check" CHECK("workers"."status" in ('active', 'paused', 'banned'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workers_wallet_address_unique` ON `workers` (`wallet_address`);--> statement-breakpoint
CREATE UNIQUE INDEX `workers_passkey_credential_id_unique` ON `workers` (`passkey_credential_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `workers_telegram_chat_id_unique` ON `workers` (`telegram_chat_id`);--> statement-breakpoint
CREATE INDEX `workers_country_city_status_idx` ON `workers` (`country`,`city`,`status`);