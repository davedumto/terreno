PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_events_kind_check" CHECK("__new_task_events"."kind" in ('paid', 'escrowed', 'notified', 'second_wave_notified', 'claimed', 'claim_expired', 'submitted', 'released', 'refunded', 'policy_rejected', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_task_events`("id", "task_id", "kind", "data", "created_at") SELECT "id", "task_id", "kind", "data", "created_at" FROM `task_events`;--> statement-breakpoint
DROP TABLE `task_events`;--> statement-breakpoint
ALTER TABLE `__new_task_events` RENAME TO `task_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `task_events_task_id_idx` ON `task_events` (`task_id`);