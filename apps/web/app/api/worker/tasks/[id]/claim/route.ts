import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { workers } from "@/lib/db/schema";
import { checkOrigin } from "@/lib/csrf";
import { getSession } from "@/lib/session";
import { claimTask } from "@/lib/claim-task";

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
  const result = await claimTask(db, id, worker.id);

  switch (result.kind) {
    case "not_found":
      return NextResponse.json({ error: "not_found" }, { status: 404 });
    case "not_open":
      // Covers every way the task could already be past the open->claimed
      // edge: someone else's claim, a refund, or (rarely) still sitting at
      // paid because escrow hasn't locked yet. "already_claimed" would be
      // misleading for the latter two, so the message names the actual
      // status rather than assuming a claim is what happened.
      return NextResponse.json({ error: "not_open", status: result.status }, { status: 409 });
    case "language_mismatch":
      return NextResponse.json({ error: "language_mismatch" }, { status: 403 });
    case "already_holding_a_claim":
      return NextResponse.json({ error: "already_holding_a_claim" }, { status: 409 });
    case "already_claimed":
      return NextResponse.json({ error: "already_claimed" }, { status: 409 });
    case "escrow_failed":
      return NextResponse.json({ error: "try_again" }, { status: 502 });
    case "claimed":
      return NextResponse.json({
        task_id: result.task.id,
        status: result.task.status,
        claim_expires_at: new Date(result.task.claimExpiresAt ?? Date.now()).toISOString(),
      });
  }
}
