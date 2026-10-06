import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { taskSchemaByType } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { ConcurrentTransitionError, transition } from "@/lib/db/transition";
import { checkOrigin } from "@/lib/csrf";
import { getSession } from "@/lib/session";
import { assign as escrowAssign, escrowConfigFromEnv, taskIdToEscrowKey } from "@/lib/escrow";

/**
 * Returns false (and lets the caller 403) only when the task's type is
 * `translate` and the worker's languages don't include the requested
 * target language. Not in SPEC.md's written claim rules, which only scope
 * the language filter to notification targeting (section 12); added by
 * agreement on 2026-10-06 (see docs/decisions.md) because nothing else in
 * the spec stops a wrong-language submission from still getting paid.
 */
function workerCanClaim(task: typeof tasks.$inferSelect, worker: typeof workers.$inferSelect): boolean {
  if (task.type !== "translate") {
    return true;
  }
  const parsed = taskSchemaByType.translate.safeParse(task.input);
  if (!parsed.success) {
    return false;
  }
  return worker.languages.includes(parsed.data.target_language);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [worker] = await db.select().from(workers).where(eq(workers.id, session.workerId));
  if (!worker || worker.status !== "active") {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const { id } = await params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (task.status !== "open") {
    // Covers every way the task could already be past the open->claimed
    // edge: someone else's claim, a refund, or (rarely) still sitting at
    // paid because escrow hasn't locked yet. "already_claimed" would be
    // misleading for the latter two, so the message names the actual
    // status rather than assuming a claim is what happened.
    return NextResponse.json({ error: "not_open", status: task.status }, { status: 409 });
  }

  if (!workerCanClaim(task, worker)) {
    return NextResponse.json({ error: "language_mismatch" }, { status: 403 });
  }

  const [existingClaim] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.workerId, worker.id), eq(tasks.status, "claimed")));
  if (existingClaim) {
    return NextResponse.json({ error: "already_holding_a_claim" }, { status: 409 });
  }

  const claimedAt = Date.now();
  let claimed;
  try {
    // SPEC.md section 12's atomic claim UPDATE: transition()'s AND
    // status = 'open' guard is exactly this, generalized to every edge.
    claimed = await transition(db, task, "claimed", { workerId: worker.id, claimedAt });
  } catch (err) {
    if (err instanceof ConcurrentTransitionError) {
      // ConcurrentTransitionError here has two distinct real causes that
      // read identically from transition()'s point of view, so tell them
      // apart by re-reading: either someone else's claim on THIS task won
      // (the common case, caught by the row guard), or this worker's own
      // existingClaim check above raced against a second simultaneous
      // request from the same worker and lost (caught by the partial
      // unique index instead). Reporting the wrong one would blame "this
      // task was taken" when the real story is "you already hold another
      // claim."
      const [reloaded] = await db.select().from(tasks).where(eq(tasks.id, task.id));
      if (reloaded?.status === "open") {
        return NextResponse.json({ error: "already_holding_a_claim" }, { status: 409 });
      }
      return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    }
    throw err;
  }

  // SPEC.md section 9: if assign() fails, roll the claim back synchronously
  // and tell the worker to try again, rather than leaving it for the
  // sweeper. Logged as "failed", not the edge's default "claim_expired",
  // since this isn't a real 15-minute timeout (SPEC.md section 4 vs this
  // route's own early-failure case; see docs/decisions.md, 2026-10-06).
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
    return NextResponse.json({ error: "try_again" }, { status: 502 });
  }

  return NextResponse.json({
    task_id: claimed.id,
    status: claimed.status,
    claim_expires_at: new Date(claimed.claimExpiresAt ?? claimedAt).toISOString(),
  });
}
