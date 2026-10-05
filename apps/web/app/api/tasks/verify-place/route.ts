import { NextRequest, NextResponse } from "next/server";
import { verifyPlaceSchema, TASK_PRICES_STROOPS } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { transition } from "@/lib/db/transition";
import { processX402Request, resourceConfigFor } from "@/lib/x402";
import { isCityLive } from "@/lib/coverage";
import { createTask as escrowCreateTask, escrowConfigFromEnv } from "@/lib/escrow";
import { generateTaskToken, hashTaskToken } from "@/lib/task-token";
import { createHash } from "node:crypto";
import { ulid } from "ulid";

const AMOUNT_STROOPS = TASK_PRICES_STROOPS.verify_place;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function taskIdToEscrowKey(taskId: string): Buffer {
  return createHash("sha256").update(taskId).digest();
}

export async function POST(req: NextRequest): Promise<Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_input", details: "body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = verifyPlaceSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_input", details: parsed.error.issues },
      { status: 400 },
    );
  }
  const input = parsed.data;

  // Coverage check (SPEC.md section 6 step 3). The policy/LLM check
  // (section 13) is explicitly Phase 5 work per the build prompt's Phase 2
  // checklist, not wired in yet.
  const live = await isCityLive(db, input.location.country, input.location.city);
  if (!live) {
    return NextResponse.json({ error: "no_coverage" }, { status: 409 });
  }

  const result = await processX402Request(
    req,
    "verify-place",
    {
      accepts: resourceConfigFor({
        payTo: requireEnv("TREASURY_PUBLIC_KEY"),
        amountStroops: AMOUNT_STROOPS,
        asset: requireEnv("USDC_CONTRACT_ID"),
      }),
      resource: `${requireEnv("APP_URL")}/api/tasks/verify-place`,
      description:
        "A local person checks whether a place exists and is open, with a photo. Answer within your deadline or automatic refund.",
      mimeType: "application/json",
    },
  );

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
        type: "verify_place",
        status: "paid",
        input,
        country: input.location.country,
        city: input.location.city,
        price: AMOUNT_STROOPS,
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
  // and the sweeper (Phase 4) retries create_task 3 times, then refunds
  // from treasury directly. No sweeper exists yet in Phase 2, so a
  // failure here is surfaced as 502 rather than silently left stuck;
  // the task row itself is already durable and will be picked up once
  // the sweeper exists.
  let escrowTxHash: string;
  try {
    const escrowConfig = escrowConfigFromEnv();
    const escrowResult = await escrowCreateTask(
      escrowConfig,
      taskIdToEscrowKey(taskId),
      settlement.payer,
      BigInt(AMOUNT_STROOPS),
      BigInt(Math.floor(deadlineAt / 1000)),
    );
    escrowTxHash = escrowResult.txHash;
  } catch (err) {
    console.error("create_task escrow lock failed", err);
    return NextResponse.json({ error: "escrow_failed" }, { status: 502 });
  }

  const opened = await transition(db, task, "open", { escrowTxHash });

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
