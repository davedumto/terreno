import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { getSession } from "@/lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [worker] = await db.select().from(workers).where(eq(workers.id, session.workerId));
  if (!worker) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const { id } = await params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // A worker may look at an open task (to decide whether to claim it) or
  // their own claimed/submitted/completed task. Anyone else's claimed task,
  // or a task in a city/country this worker has no business seeing, is not
  // this route's job to list (that's /api/worker/tasks), but once someone
  // has the id directly, only gate on "is this actually theirs or still
  // open," not on routing fields.
  const isOwnTask = task.workerId === worker.id;
  if (task.status !== "open" && !isOwnTask) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  return NextResponse.json({
    task_id: task.id,
    type: task.type,
    status: task.status,
    input: task.input,
    price_usdc: task.price / STROOPS_PER_USDC,
    deadline_at: new Date(task.deadlineAt).toISOString(),
    claim_expires_at: task.claimExpiresAt ? new Date(task.claimExpiresAt).toISOString() : null,
    is_own_claim: isOwnTask,
    release_tx: task.releaseTxHash
      ? `https://stellar.expert/explorer/testnet/tx/${task.releaseTxHash}`
      : null,
  });
}
