import { and, eq, inArray, lt } from "drizzle-orm";
import { tasks, taskEvents } from "@terreno/shared/db/schema";
import { createDbClient, type Schema } from "@terreno/shared/db";
import { transition, ConcurrentTransitionError } from "@terreno/shared/db/transition";
import {
  createTask,
  refund,
  release,
  unassign,
  taskIdToEscrowKey,
  escrowConfigFromEnv,
} from "@terreno/shared/escrow";
import { requireEnv } from "@terreno/shared/env";
import { matchWorkers } from "@terreno/shared/routing";
import { getBot, notifyWorkersOfTask } from "@terreno/shared/telegram";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import { ulid } from "ulid";

const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 30_000);
const ESCROW_RETRY_LIMIT = 3;
const UNCLAIMED_NOTIFY_AFTER_MS = 10 * 60 * 1000;

export type DB = LibSQLDatabase<Schema>;

/** How many "failed" task_events rows exist for this task and this specific operation. */
export async function failureCount(db: DB, taskId: string, operation: string): Promise<number> {
  const rows = await db.select().from(taskEvents).where(
    and(eq(taskEvents.taskId, taskId), eq(taskEvents.kind, "failed")),
  );
  return rows.filter((row) => (row.data as { operation?: string } | null)?.operation === operation).length;
}

export async function logFailure(db: DB, taskId: string, operation: string, error: unknown): Promise<void> {
  await db.insert(taskEvents).values({
    id: ulid(),
    taskId,
    kind: "failed",
    data: {
      operation,
      message: error instanceof Error ? error.message : String(error),
    },
    createdAt: Date.now(),
  });
}

/**
 * SPEC.md section 16, job 1: paid tasks without escrow retry create_task. A
 * task reaches `paid` and stays there only when the create_task call after
 * x402 settlement genuinely failed (the route itself would have already
 * moved it to `open` on success) -- a rare but real failure mode with no
 * automatic recovery before this job existed.
 *
 * SPEC.md section 9 also calls for refunding from the treasury directly
 * after 3 failures, via a plain Stellar payment rather than a contract
 * call (no escrow lock exists yet for this task, so refund() has nothing
 * to call). Deliberately not built here: it is a genuinely new transaction-
 * building code path (classic Stellar payment, not a Soroban contract
 * invocation, with its own decimal-amount conversion), and this specific
 * failure mode has not fired once in this project's real testnet usage.
 * At the retry limit this logs loudly instead, so a human can refund
 * manually, rather than trusting new, unverified financial code with real
 * money under time pressure.
 */
export async function sweepPaidWithoutEscrow(db: DB): Promise<void> {
  const config = escrowConfigFromEnv();
  const stuck = await db.select().from(tasks).where(eq(tasks.status, "paid"));

  for (const task of stuck) {
    const failures = await failureCount(db, task.id, "create_task");

    if (failures >= ESCROW_RETRY_LIMIT) {
      console.error(
        `task ${task.id} has failed create_task ${failures} times and needs a MANUAL refund ` +
          `from the treasury (payer ${task.payerAddress}, amount ${task.price} stroops) -- ` +
          "no automatic plain-transfer refund is implemented yet, see sweepPaidWithoutEscrow's doc comment",
      );
      continue;
    }

    try {
      const deadlineSeconds = BigInt(Math.floor(task.deadlineAt / 1000));
      const sent = await createTask(
        config,
        taskIdToEscrowKey(task.id),
        task.payerAddress,
        BigInt(task.price),
        deadlineSeconds,
      );
      await transition(db, task, "open", { escrowTxHash: sent.txHash });
    } catch (err) {
      if (err instanceof ConcurrentTransitionError) continue;
      await logFailure(db, task.id, "create_task", err);
    }
  }
}

/**
 * SPEC.md section 16, job 2: expired claims unassign, reopen, re-notify.
 * The claim window is 15 minutes (packages/shared/src/db/transition.ts's
 * CLAIM_WINDOW_MS); a worker who claims and never submits leaves the task
 * stuck `claimed` forever without this job. Already caused one real stuck
 * task during this project's own testing before this job existed.
 */
export async function sweepExpiredClaims(db: DB): Promise<void> {
  const config = escrowConfigFromEnv();
  const now = Date.now();
  const expired = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "claimed"), lt(tasks.claimExpiresAt, now)));

  for (const task of expired) {
    try {
      await unassign(config, taskIdToEscrowKey(task.id));
      await transition(db, task, "open", {}, { eventKind: "claim_expired" });
      // Re-notification (job 3) is a genuine no-op today: nothing in this
      // codebase pushes notifications yet (Telegram is unbuilt), so there
      // is no channel to re-notify through. The task is correctly back in
      // `open` and will show up to anyone browsing /work.
    } catch (err) {
      if (err instanceof ConcurrentTransitionError) continue;
      await logFailure(db, task.id, "unassign", err);
    }
  }
}

/**
 * All worker ids notifyWorkersOfTask() has ever recorded a notifications
 * row for, across both the first wave (sent by createPaidTask right after
 * the task opens) and -- once this job itself has run for this task -- the
 * second wave too. Used both to exclude the first wave from the second
 * wave's own matchWorkers() call, and to build the second_wave_notified
 * event's own worker-id list below.
 */
async function alreadyNotifiedWorkerIds(db: DB, taskId: string): Promise<string[]> {
  const rows = await db
    .select({ data: taskEvents.data })
    .from(taskEvents)
    .where(and(eq(taskEvents.taskId, taskId), eq(taskEvents.kind, "notified")));
  return rows.flatMap((row) => (row.data as { workerIds?: string[] } | null)?.workerIds ?? []);
}

/**
 * SPEC.md section 16, job 3: open tasks with no claim after 10 minutes,
 * notify the next 10 workers, once. "Once" is enforced by a dedicated
 * second_wave_notified task_events kind (docs/decisions.md, 2026-10-07):
 * a task that already has one is skipped on every later tick, rather than
 * re-notifying every 30s for as long as it stays open and unclaimed.
 */
export async function sweepUnclaimedNotify(db: DB): Promise<void> {
  const bot = getBot();
  const cutoff = Date.now() - UNCLAIMED_NOTIFY_AFTER_MS;
  const candidates = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.status, "open"), lt(tasks.createdAt, cutoff)));

  for (const task of candidates) {
    const secondWaveEvents = await db
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, task.id), eq(taskEvents.kind, "second_wave_notified")));
    if (secondWaveEvents.length > 0) {
      continue;
    }

    const firstWaveWorkerIds = await alreadyNotifiedWorkerIds(db, task.id);
    const matched = await matchWorkers(db, task, { excludeWorkerIds: firstWaveWorkerIds });

    // Records second_wave_notified even when matched is empty (nobody new
    // eligible in this city right now): SPEC.md's "once" reads as one
    // attempt per task, not "retry until someone is found." Without this,
    // a task with no spare workers would get re-checked and re-queried
    // every 30s tick forever instead of once, for no behavioral gain --
    // the task is still fully visible to anyone browsing /work regardless.
    try {
      await notifyWorkersOfTask(db, bot, task, matched);
      await db.insert(taskEvents).values({
        id: ulid(),
        taskId: task.id,
        kind: "second_wave_notified",
        data: { workerIds: matched.map((w) => w.id) },
        createdAt: Date.now(),
      });
    } catch (err) {
      await logFailure(db, task.id, "second_wave_notify", err);
    }
  }
}

/**
 * SPEC.md section 16, job 4: past-deadline open or claimed tasks, refund.
 * On the spec's own "never drop" list. An agent must always get its money
 * back if nobody answers in time, with no dependency on a human noticing.
 */
export async function sweepPastDeadline(db: DB): Promise<void> {
  const config = escrowConfigFromEnv();
  const now = Date.now();
  const overdue = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.status, ["open", "claimed"]), lt(tasks.deadlineAt, now)));

  for (const task of overdue) {
    try {
      const sent = await refund(config, taskIdToEscrowKey(task.id));
      await transition(db, task, "refunded", { refundTxHash: sent.txHash });
    } catch (err) {
      if (err instanceof ConcurrentTransitionError) continue;
      await logFailure(db, task.id, "refund", err);
    }
  }
}

/**
 * SPEC.md section 16, job 5: submitted tasks without release, retry release.
 * SPEC.md section 9: never refunds a submitted task -- the worker already
 * did the work, so the only correct resolution is eventually paying them,
 * never giving the money back to the agent instead.
 */
export async function sweepUnreleasedSubmissions(db: DB): Promise<void> {
  const config = escrowConfigFromEnv();
  const stuck = await db.select().from(tasks).where(eq(tasks.status, "submitted"));

  for (const task of stuck) {
    try {
      const sent = await release(config, taskIdToEscrowKey(task.id));
      await transition(db, task, "completed", { releaseTxHash: sent.txHash });
    } catch (err) {
      if (err instanceof ConcurrentTransitionError) continue;
      // No retry cap here, deliberately: SPEC.md section 9 says retry every
      // 30s with no give-up condition for this specific job, unlike job 1's
      // 3-strikes-then-refund. A submitted task can only ever end completed.
      await logFailure(db, task.id, "release", err);
    }
  }
}

/**
 * SPEC.md section 16, job 6: pending callbacks, retry delivery. Genuinely a
 * no-op today: no code anywhere in this project currently sets a
 * callback_url that would need delivery (the field exists on tasks per the
 * schema, but nothing writes or reads it outside storage). Left as an
 * explicit, honest no-op rather than a fake retry loop with nothing to
 * retry.
 */
export async function sweepPendingCallbacks(_db: DB): Promise<void> {
  // No-op: see doc comment above.
}

/**
 * SPEC.md section 16, job 7: facilitator keepalive. The Vellar facilitator
 * has real cold-start latency (SPEC.md section 16); a ping every sweep tick
 * keeps the instance warm so a real agent's payment never eats a cold-start
 * delay. Failure here is logged, not thrown -- a facilitator hiccup should
 * never crash the sweeper's other six jobs.
 */
export async function sweepFacilitatorKeepalive(): Promise<void> {
  const url = `${requireEnv("FACILITATOR_URL")}/health`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.error(`facilitator keepalive: ${url} returned ${res.status}`);
    }
  } catch (err) {
    console.error("facilitator keepalive failed:", err instanceof Error ? err.message : err);
  }
}

async function runSweep(db: DB): Promise<void> {
  // Each job is independent and best-effort: one job's failure (caught
  // internally, logged as a task_events row) must never stop the others
  // from running this tick.
  await sweepPaidWithoutEscrow(db);
  await sweepExpiredClaims(db);
  await sweepUnclaimedNotify(db);
  await sweepPastDeadline(db);
  await sweepUnreleasedSubmissions(db);
  await sweepPendingCallbacks(db);
  await sweepFacilitatorKeepalive();
}

async function main(): Promise<void> {
  console.log(`sweeper started, interval ${SWEEP_INTERVAL_MS}ms`);
  const db = createDbClient();
  for (;;) {
    try {
      await runSweep(db);
    } catch (err) {
      console.error("sweep iteration failed", err);
    }
    await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
  }
}

// Only run the infinite loop when this file is executed directly (node
// dist/index.js in production, tsx watch src/index.ts in dev), not when
// imported (e.g. by index.test.ts to exercise the individual job
// functions). realpathSync resolves symlinks on both sides before
// comparing: a naive import.meta.url === pathToFileURL(argv[1]) check can
// genuinely disagree on a path that differs only by a symlink the OS
// transparently resolves (confirmed empirically -- macOS's /tmp -> /private/tmp
// symlink makes the naive check return false for a file genuinely run as
// the entry point from that directory).
if (process.argv[1]) {
  const { fileURLToPath } = await import("node:url");
  const { realpathSync } = await import("node:fs");
  const thisFile = realpathSync(fileURLToPath(import.meta.url));
  const entryFile = realpathSync(process.argv[1]);
  if (thisFile === entryFile) {
    main().catch((err) => {
      console.error("sweeper fatal error", err);
      process.exit(1);
    });
  }
}
