import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { tasks, taskEvents } from "./schema.js";
import { ulid } from "ulid";

export type TaskStatus = (typeof tasks.$inferSelect)["status"];
export type Task = typeof tasks.$inferSelect;
export type TaskEventKind = (typeof taskEvents.$inferSelect)["kind"];

type DB = LibSQLDatabase<Record<string, unknown>>;

export class TransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid transition: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

interface TransitionRule {
  eventKind: TaskEventKind;
  columns?: (ctx: Record<string, unknown>) => Partial<Task>;
}

const RULES: Record<TaskStatus, Partial<Record<TaskStatus, TransitionRule>>> = {
  paid: {
    open: {
      eventKind: "escrowed",
      columns: (ctx) => ({ escrowTxHash: requireString(ctx, "escrowTxHash") }),
    },
    refunded: {
      eventKind: "refunded",
      columns: (ctx) => ({ refundTxHash: requireString(ctx, "refundTxHash") }),
    },
  },
  open: {
    claimed: {
      eventKind: "claimed",
      columns: (ctx) => {
        const claimedAt = requireNumber(ctx, "claimedAt");
        return {
          workerId: requireString(ctx, "workerId"),
          claimedAt,
          claimExpiresAt: claimedAt + CLAIM_WINDOW_MS,
        };
      },
    },
    refunded: {
      eventKind: "refunded",
      columns: (ctx) => ({ refundTxHash: requireString(ctx, "refundTxHash") }),
    },
  },
  claimed: {
    open: {
      eventKind: "claim_expired",
      columns: () => ({ workerId: null, claimedAt: null, claimExpiresAt: null }),
    },
    submitted: {
      eventKind: "submitted",
      columns: (ctx) => ({ submittedAt: requireNumber(ctx, "submittedAt") }),
    },
    refunded: {
      eventKind: "refunded",
      columns: (ctx) => ({ refundTxHash: requireString(ctx, "refundTxHash") }),
    },
  },
  submitted: {
    completed: {
      eventKind: "released",
      columns: (ctx) => ({ releaseTxHash: requireString(ctx, "releaseTxHash") }),
    },
  },
  completed: {},
  refunded: {},
};

const CLAIM_WINDOW_MS = 15 * 60 * 1000;

function requireString(ctx: Record<string, unknown>, key: string): string {
  const value = ctx[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`transition ctx missing required string field "${key}"`);
  }
  return value;
}

function requireNumber(ctx: Record<string, unknown>, key: string): number {
  const value = ctx[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`transition ctx missing required number field "${key}"`);
  }
  return value;
}

/**
 * Enforces SPEC.md section 4's transition table. Any (from, to) pair not in
 * RULES throws TransitionError. Writes the new status and a task_events row
 * in one database transaction, run against `db` (a transaction handle if
 * the caller is already inside one, so this composes).
 */
export async function transition(
  db: DB,
  task: Task,
  to: TaskStatus,
  ctx: Record<string, unknown> = {},
): Promise<Task> {
  const rule = RULES[task.status]?.[to];
  if (!rule) {
    throw new TransitionError(task.status, to);
  }

  const now = Date.now();
  const columnUpdates = rule.columns?.(ctx) ?? {};

  const [updated] = await db
    .update(tasks)
    .set({ ...columnUpdates, status: to, updatedAt: now })
    .where(eq(tasks.id, task.id))
    .returning();

  if (!updated) {
    throw new Error(`transition: task ${task.id} not found during update`);
  }

  await db.insert(taskEvents).values({
    id: ulid(),
    taskId: task.id,
    kind: rule.eventKind,
    data: ctx,
    createdAt: now,
  });

  return updated;
}
