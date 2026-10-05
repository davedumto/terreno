import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { verifyTaskToken } from "@/lib/task-token";

// SPEC.md section 6: poll no more than every 10 seconds; 429 otherwise.
// In-memory per-process; resets on deploy/restart and does not share
// state across multiple instances. Acceptable for Phase 2 (a single
// Railway web service); revisit if scaled beyond one instance.
const MIN_POLL_INTERVAL_MS = 10_000;
const lastPollAt = new Map<string, number>();

function extractBearerToken(req: NextRequest): string | null {
  const header = req.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    return null;
  }
  return header.slice("Bearer ".length);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const { id } = await params;

  const token = extractBearerToken(req);
  if (!token) {
    return NextResponse.json({ error: "bad_token" }, { status: 401 });
  }

  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task || !verifyTaskToken(token, task.taskTokenHash)) {
    // Same response whether the task is missing or the token is wrong,
    // so a bad guess can't distinguish "wrong token" from "no such task".
    return NextResponse.json({ error: "bad_token" }, { status: 401 });
  }

  const now = Date.now();
  const last = lastPollAt.get(id);
  if (last !== undefined && now - last < MIN_POLL_INTERVAL_MS) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }
  lastPollAt.set(id, now);

  const transactions: Record<string, string> = {
    payment: task.paymentTxHash,
  };
  if (task.escrowTxHash) transactions.escrow = task.escrowTxHash;
  if (task.releaseTxHash) transactions.release = task.releaseTxHash;
  if (task.refundTxHash) transactions.refund = task.refundTxHash;

  return NextResponse.json({
    task_id: task.id,
    type: task.type,
    status: task.status,
    // result and worker are populated once submissions (Phase 3) and
    // reputation (Phase 5) exist; absent rather than fabricated until then.
    transactions,
  });
}
