import { NextRequest, NextResponse } from "next/server";
import type { ZodType } from "zod";
import type { TaskType } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { transition } from "@/lib/db/transition";
import { processX402Request, resourceConfigFor } from "@/lib/x402";
import { isCityLive } from "@/lib/coverage";
import { createTask as escrowCreateTask, escrowConfigFromEnv, taskIdToEscrowKey } from "@/lib/escrow";
import { requireEnv } from "@/lib/env";
import { generateTaskToken, hashTaskToken } from "@/lib/task-token";
import { ulid } from "ulid";
import { matchWorkers } from "@/lib/routing";
import { getBot, notifyWorkersOfTask } from "@/lib/telegram";

interface TaskLocation {
  country: string;
  city: string;
}

interface PaidTaskInput {
  location: TaskLocation;
  deadline_minutes: number;
  callback_url?: string;
}

interface CreatePaidTaskConfig<T extends PaidTaskInput> {
  type: TaskType;
  schema: ZodType<T>;
  amountStroops: number;
  routeKey: string;
  description: string;
}

/**
 * Shared implementation behind every POST /api/tasks/{type} route (SPEC.md
 * section 6): validate, check coverage, settle x402, insert the task row,
 * lock escrow, transition to open. The three real routes
 * (verify-place/check-price/translate) differ only in their zod schema,
 * price, and the x402 description shown to the agent -- everything else,
 * including every failure path, must behave identically, so it lives here
 * once instead of in three files that could silently drift.
 */
export async function createPaidTask<T extends PaidTaskInput>(
  req: NextRequest,
  config: CreatePaidTaskConfig<T>,
): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", details: "body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = config.schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Coverage check (SPEC.md section 6 step 3). The policy/LLM check
  // (section 13) is explicitly Phase 5 work, not wired in yet.
  const live = await isCityLive(db, input.location.country, input.location.city);
  if (!live) {
    return NextResponse.json({ error: "no_coverage" }, { status: 409 });
  }

  const result = await processX402Request(req, config.routeKey, {
    accepts: resourceConfigFor({
      payTo: requireEnv("TREASURY_PUBLIC_KEY"),
      amountStroops: config.amountStroops,
      asset: requireEnv("USDC_CONTRACT_ID"),
    }),
    resource: `${requireEnv("APP_URL")}/api/tasks/${config.routeKey}`,
    description: config.description,
    mimeType: "application/json",
  });

  if (result.kind === "no-payment-required") {
    // Should not happen for a route that always requires payment, but
    // fail closed rather than silently proceed unpaid.
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }

  if (result.kind === "payment-error") {
    return result.response;
  }

  // Payment verified but not yet settled. Settle now, after the business
  // logic that must succeed before money moves (hard rule: fail closed on
  // payment verification and escrow errors).
  let settlement;
  try {
    settlement = await result.settle();
  } catch (err) {
    console.error("x402 settlement failed", err);
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }

  if (!settlement.success || !settlement.payer) {
    return NextResponse.json({ error: "payment_required" }, { status: 402 });
  }

  const taskId = ulid();
  const taskToken = generateTaskToken();
  const now = Date.now();
  const deadlineAt = now + input.deadline_minutes * 60 * 1000;

  let task;
  try {
    [task] = await db
      .insert(tasks)
      .values({
        id: taskId,
        type: config.type,
        status: "paid",
        input,
        country: input.location.country,
        city: input.location.city,
        price: config.amountStroops,
        fee: 0,
        payerAddress: settlement.payer,
        paymentTxHash: settlement.transaction,
        taskTokenHash: hashTaskToken(taskToken),
        callbackUrl: input.callback_url,
        deadlineAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
  } catch (err) {
    // payment_tx_hash is unique (SPEC.md section 5): this is the replay
    // guard. A real collision here means settlement somehow produced a
    // hash already used by another task, which should not happen for a
    // freshly-signed payment. Fail closed rather than silently losing the
    // agent's money with no task to show for it.
    console.error("duplicate payment_tx_hash on task insert", err);
    return NextResponse.json({ error: "duplicate_payment" }, { status: 409 });
  }

  if (!task) {
    return NextResponse.json({ error: "duplicate_payment" }, { status: 409 });
  }

  // Lock escrow. SPEC.md section 9: if this fails, the task stays `paid`
  // and the sweeper retries create_task 3 times, then logs for a human to
  // refund manually (apps/sweeper/src/index.ts's sweepPaidWithoutEscrow).
  // The task row itself is already durable, so a failure here is surfaced
  // as 502 rather than lost.
  let escrowTxHash: string;
  try {
    const escrowConfig = escrowConfigFromEnv();
    const escrowResult = await escrowCreateTask(
      escrowConfig,
      taskIdToEscrowKey(taskId),
      settlement.payer,
      BigInt(config.amountStroops),
      BigInt(Math.floor(deadlineAt / 1000)),
    );
    escrowTxHash = escrowResult.txHash;
  } catch (err) {
    console.error("create_task escrow lock failed", err);
    return NextResponse.json({ error: "escrow_failed" }, { status: 502 });
  }

  const opened = await transition(db, task, "open", { escrowTxHash });

  // SPEC.md section 2: the agent polls separately from the worker side --
  // nothing here should make a successful, already-paid-and-escrowed task
  // return an error to the agent just because Telegram is slow or down.
  // notifyWorkersOfTask itself already swallows a per-worker send failure;
  // this guards the one failure mode that isn't per-worker (matchWorkers
  // throwing, or TELEGRAM_BOT_TOKEN being unset). If nobody gets notified,
  // the sweeper's second wave (sweepUnclaimedNotify) retries 10 minutes
  // later, and the task is already visible in /work regardless.
  try {
    const matched = await matchWorkers(db, opened);
    await notifyWorkersOfTask(db, getBot(), opened, matched);
  } catch (err) {
    console.error("failed to notify workers of new task", opened.id, err);
  }

  return NextResponse.json(
    {
      task_id: opened.id,
      task_token: taskToken,
      status: opened.status,
      deadline_at: new Date(opened.deadlineAt).toISOString(),
      poll_url: `/api/tasks/${opened.id}`,
      payment_tx: `https://stellar.expert/explorer/testnet/tx/${settlement.transaction}`,
    },
    { status: 201 },
  );
}
