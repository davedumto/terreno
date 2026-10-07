import { and, DrizzleQueryError, eq } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { ResultSet } from "@libsql/client";
import { tasks, taskEvents } from "./schema";
import { ulid } from "ulid";

export type TaskStatus = (typeof tasks.$inferSelect)["status"];
export type Task = typeof tasks.$inferSelect;
export type TaskEventKind = (typeof taskEvents.$inferSelect)["kind"];

// The real common ancestor of both LibSQLDatabase and LibSQLTransaction
// (confirmed by reading drizzle-orm's own libsql driver source), used
// instead of either directly: their own full types don't structurally
// match each other (a transaction's relational-schema type parameter is
// inferred from the actual schema passed to drizzle(), not a generic
// placeholder), so accepting a LibSQLDatabase | LibSQLTransaction union
// would force every caller inside a db.transaction() callback to fight a
// type mismatch instead of composing the way this function is designed to
// (per its own doc comment below). Only .update()/.insert() are ever
// called here, and those don't depend on the schema parameter at all.
type DB = BaseSQLiteDatabase<"async", ResultSet, Record<string, unknown>>;

export class TransitionError extends Error {
  constructor(
    public readonly from: TaskStatus,
    public readonly to: TaskStatus,
  ) {
    super(`Invalid transition: ${from} -> ${to}`);
    this.name = "TransitionError";
  }
}

/**
 * Thrown when a concurrent write beat this one to the same invariant:
 * either the task's status no longer matched what the caller read (the
 * AND status = <from> guard matched zero rows), or a database constraint
 * caught a conflict the guard doesn't cover, e.g. SPEC.md section 12's "one
 * active claim per worker" partial unique index. Either way the caller
 * should re-read and decide whether to retry or treat the loss as normal
 * ("someone else won"), not surface it as a server error. Distinct from
 * TransitionError, which means the (from, to) pair itself is never valid.
 */
export class ConcurrentTransitionError extends Error {
  constructor(
    public readonly taskId: string,
    public readonly expectedFrom: TaskStatus,
  ) {
    super(`task ${taskId} was no longer "${expectedFrom}" when the transition ran`);
    this.name = "ConcurrentTransitionError";
  }
}

/** True for a SQLite UNIQUE/CHECK constraint violation, unwrapped from Drizzle's query-error wrapper. */
function isConstraintViolation(err: unknown): boolean {
  if (!(err instanceof DrizzleQueryError)) {
    return false;
  }
  const cause = err.cause as { code?: string } | undefined;
  return cause?.code === "SQLITE_CONSTRAINT";
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

export interface TransitionOptions {
  /**
   * Overrides the edge's default task_events.kind for this call. The same
   * (from, to) edge can represent more than one real event (e.g.
   * claimed -> open happens both on a genuine 15-minute claim expiry and on
   * an immediate on-chain assign() failure rollback); the default kind only
   * fits one of those, so a caller representing the other must say so
   * explicitly rather than have it logged under the wrong label.
   */
  eventKind?: TaskEventKind;
}

/**
 * Enforces SPEC.md section 4's transition table. Any (from, to) pair not in
 * RULES throws TransitionError. Writes the new status and a task_events row
 * in one database transaction, run against `db` (a transaction handle if
 * the caller is already inside one, so this composes).
 *
 * The update is guarded by `AND status = <task.status>` (SPEC.md section
 * 12's atomic claim pattern, generalized to every edge): if another writer
 * already moved the task off that status, zero rows match and this throws
 * ConcurrentTransitionError instead of overwriting that write. Callers racing
 * for the same edge (two workers claiming, two sweeper ticks releasing) must
 * re-read the task and decide whether to retry or treat the loss as normal
 * ("someone else won").
 */
export async function transition(
  db: DB,
  task: Task,
  to: TaskStatus,
  ctx: Record<string, unknown> = {},
  options: TransitionOptions = {},
): Promise<Task> {
  const rule = RULES[task.status]?.[to];
  if (!rule) {
    throw new TransitionError(task.status, to);
  }

  const now = Date.now();
  const columnUpdates = rule.columns?.(ctx) ?? {};

  let updated: Task | undefined;
  try {
    [updated] = await db
      .update(tasks)
      .set({ ...columnUpdates, status: to, updatedAt: now })
      .where(and(eq(tasks.id, task.id), eq(tasks.status, task.status)))
      .returning();
  } catch (err) {
    if (isConstraintViolation(err)) {
      throw new ConcurrentTransitionError(task.id, task.status);
    }
    throw err;
  }

  if (!updated) {
    throw new ConcurrentTransitionError(task.id, task.status);
  }

  await db.insert(taskEvents).values({
    id: ulid(),
    taskId: task.id,
    kind: options.eventKind ?? rule.eventKind,
    data: ctx,
    createdAt: now,
  });

  return updated;
}
