import { and, eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { taskSchemaByType } from "@terreno/shared";
import { tasks, workers } from "./db/schema";
import { ConcurrentTransitionError, transition } from "./db/transition";
import { assign as escrowAssign, escrowConfigFromEnv, taskIdToEscrowKey } from "./escrow";

type DB = LibSQLDatabase<Record<string, unknown>>;
type Task = typeof tasks.$inferSelect;

export type ClaimTaskResult =
  | { kind: "claimed"; task: Task }
  | { kind: "not_found" }
  | { kind: "not_open"; status: Task["status"] }
  | { kind: "language_mismatch" }
  | { kind: "already_holding_a_claim" }
  | { kind: "already_claimed" }
  | { kind: "escrow_failed" };

/**
 * Only `translate` tasks gate on language; not in SPEC.md's written claim
 * rules (section 12 scopes the language filter to notification targeting
 * only), added by agreement on 2026-10-06 (docs/decisions.md) because
 * nothing else in the spec stops a wrong-language submission from still
 * getting paid.
 */
function workerCanClaim(task: Task, worker: typeof workers.$inferSelect): boolean {
  if (task.type !== "translate") {
    return true;
  }
  const parsed = taskSchemaByType.translate.safeParse(task.input);
  if (!parsed.success) {
    return false;
  }
  return worker.languages.includes(parsed.data.target_language);
}

/**
 * The real claim flow behind POST /api/worker/tasks/[id]/claim, extracted
 * so the Telegram bot's inline Claim button runs the exact same logic
 * instead of a second, independently-fallible copy: load the task, check
 * it's open, check language eligibility, check the worker isn't already
 * holding a different claim, atomically transition to claimed, lock escrow
 * to the worker's wallet, and roll back to open on an escrow failure.
 *
 * Identity, origin/CSRF, and the final response shape are each caller's own
 * concern: the HTTP route resolves workerId from a session cookie and
 * returns JSON; the bot resolves it from a Telegram chat id and edits a
 * message. Neither belongs in here.
 */
export async function claimTask(db: DB, taskId: string, workerId: string): Promise<ClaimTaskResult> {
  const [worker] = await db.select().from(workers).where(eq(workers.id, workerId));
  if (!worker) {
    // Caller already verified the worker exists and is active before
    // calling in (both existing callers do); a missing row here would be a
    // genuine bug, not a normal outcome, so this isn't modeled as a result
    // kind -- it surfaces as a thrown error like any other invariant break.
    throw new Error(`claimTask: worker ${workerId} not found`);
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId));
  if (!task) {
    return { kind: "not_found" };
  }

  if (task.status !== "open") {
    return { kind: "not_open", status: task.status };
  }

  if (!workerCanClaim(task, worker)) {
    return { kind: "language_mismatch" };
  }

  const [existingClaim] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workerId, worker.id), eq(tasks.status, "claimed")));
  if (existingClaim) {
    return { kind: "already_holding_a_claim" };
  }

  const claimedAt = Date.now();
  let claimed: Task;
  try {
    claimed = await transition(db, task, "claimed", { workerId: worker.id, claimedAt });
  } catch (err) {
    if (err instanceof ConcurrentTransitionError) {
      // Two distinct real causes read identically from transition()'s point
      // of view: either someone else's claim on THIS task won (the row
      // guard), or this worker's own existingClaim check above raced a
      // second simultaneous request from the same worker and lost (the
      // partial unique index instead). Re-read to tell them apart rather
      // than report the wrong one.
      const [reloaded] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      if (reloaded?.status === "open") {
        return { kind: "already_holding_a_claim" };
      }
      return { kind: "already_claimed" };
    }
    throw err;
  }

  // SPEC.md section 9: if assign() fails, roll the claim back synchronously
  // and tell the caller to try again, rather than leaving it for the
  // sweeper. Logged as "failed", not the edge's default "claim_expired",
  // since this isn't a real 15-minute timeout (docs/decisions.md, 2026-10-06).
  try {
    const escrowConfig = escrowConfigFromEnv();
    await escrowAssign(escrowConfig, taskIdToEscrowKey(task.id), worker.walletAddress);
  } catch (err) {
    console.error("assign failed, rolling back claim", err);
    try {
      await transition(db, claimed, "open", {}, { eventKind: "failed" });
    } catch (rollbackErr) {
      // The claim is now stuck assigned-in-DB but not assigned on-chain.
      // Not money-unsafe (no funds moved), but it needs the sweeper to
      // notice and reopen it rather than sitting claimed forever.
      console.error("rollback of failed claim also failed", rollbackErr);
    }
    return { kind: "escrow_failed" };
  }

  return { kind: "claimed", task: claimed };
}
