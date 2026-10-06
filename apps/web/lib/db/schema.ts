import { check, index, sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const workers = sqliteTable(
  "workers",
  {
    id: text("id").primaryKey(),
    displayName: text("display_name").notNull(),
    walletAddress: text("wallet_address").notNull().unique(),
    passkeyCredentialId: text("passkey_credential_id").notNull().unique(),
    telegramChatId: text("telegram_chat_id").unique(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    languages: text("languages", { mode: "json" }).notNull().$type<string[]>(),
    status: text("status", { enum: ["active", "paused", "banned"] }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("workers_country_city_status_idx").on(t.country, t.city, t.status),
    check("workers_status_check", sql`${t.status} in ('active', 'paused', 'banned')`),
  ],
);

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    type: text("type", { enum: ["verify_place", "check_price", "translate"] }).notNull(),
    status: text("status", {
      enum: ["paid", "open", "claimed", "submitted", "completed", "refunded"],
    }).notNull(),
    input: text("input", { mode: "json" }).notNull(),
    country: text("country").notNull(),
    city: text("city").notNull(),
    price: integer("price").notNull(),
    fee: integer("fee").notNull(),
    payerAddress: text("payer_address").notNull(),
    paymentTxHash: text("payment_tx_hash").notNull().unique(),
    escrowTxHash: text("escrow_tx_hash"),
    workerId: text("worker_id").references(() => workers.id),
    claimedAt: integer("claimed_at"),
    submittedAt: integer("submitted_at"),
    claimExpiresAt: integer("claim_expires_at"),
    deadlineAt: integer("deadline_at").notNull(),
    releaseTxHash: text("release_tx_hash"),
    refundTxHash: text("refund_tx_hash"),
    taskTokenHash: text("task_token_hash").notNull(),
    callbackUrl: text("callback_url"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [
    index("tasks_status_country_city_idx").on(t.status, t.country, t.city),
    index("tasks_status_deadline_at_idx").on(t.status, t.deadlineAt),
    index("tasks_status_claim_expires_at_idx").on(t.status, t.claimExpiresAt),
    // SPEC.md section 12: one active claim per worker at a time. Enforced
    // at the database level, not just checked in application code, so two
    // concurrent claim requests from the same worker can't both succeed.
    uniqueIndex("tasks_one_active_claim_per_worker_idx")
      .on(t.workerId)
      .where(sql`${t.status} = 'claimed'`),
    check(
      "tasks_type_check",
      sql`${t.type} in ('verify_place', 'check_price', 'translate')`,
    ),
    check(
      "tasks_status_check",
      sql`${t.status} in ('paid', 'open', 'claimed', 'submitted', 'completed', 'refunded')`,
    ),
  ],
);

export const submissions = sqliteTable("submissions", {
  id: text("id").primaryKey(),
  taskId: text("task_id")
    .notNull()
    .unique()
    .references(() => tasks.id),
  workerId: text("worker_id")
    .notNull()
    .references(() => workers.id),
  answer: text("answer", { mode: "json" }).notNull(),
  photoKey: text("photo_key"),
  createdAt: integer("created_at").notNull(),
});

export const taskEvents = sqliteTable(
  "task_events",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    kind: text("kind", {
      enum: [
        "paid",
        "escrowed",
        "notified",
        "claimed",
        "claim_expired",
        "submitted",
        "released",
        "refunded",
        "policy_rejected",
        "failed",
      ],
    }).notNull(),
    data: text("data", { mode: "json" }).notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [
    index("task_events_task_id_idx").on(t.taskId),
    check(
      "task_events_kind_check",
      sql`${t.kind} in ('paid', 'escrowed', 'notified', 'claimed', 'claim_expired', 'submitted', 'released', 'refunded', 'policy_rejected', 'failed')`,
    ),
  ],
);

export const ratings = sqliteTable(
  "ratings",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .unique()
      .references(() => tasks.id),
    score: integer("score").notNull(),
    comment: text("comment"),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [check("ratings_score_check", sql`${t.score} between 1 and 5`)],
);

export const telegramLinks = sqliteTable("telegram_links", {
  code: text("code").primaryKey(),
  workerId: text("worker_id")
    .notNull()
    .references(() => workers.id),
  expiresAt: integer("expires_at").notNull(),
});

export const notifications = sqliteTable(
  "notifications",
  {
    id: text("id").primaryKey(),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id),
    workerId: text("worker_id")
      .notNull()
      .references(() => workers.id),
    telegramChatId: text("telegram_chat_id").notNull(),
    telegramMessageId: integer("telegram_message_id").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [uniqueIndex("notifications_task_worker_idx").on(t.taskId, t.workerId)],
);
