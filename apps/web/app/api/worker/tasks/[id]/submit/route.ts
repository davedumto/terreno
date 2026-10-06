import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { answerSchemaByType, FEE_BPS, FEE_DENOMINATOR, submitTaskSchema } from "@terreno/shared";
import { checkOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import { submissions, tasks, workers } from "@/lib/db/schema";
import { ConcurrentTransitionError, transition } from "@/lib/db/transition";
import { getSession } from "@/lib/session";
import { escrowConfigFromEnv, release as escrowRelease, taskIdToEscrowKey } from "@/lib/escrow";

/**
 * SPEC.md section 9/10: a worker submits an answer for their claimed task;
 * the server validates it against the type-specific schema, saves it, then
 * immediately calls release(). If release fails, the task stays `submitted`
 * for the sweeper (Phase 4) to retry, NOT an error surfaced to the worker:
 * their answer is safely saved either way.
 *
 * SPEC.md section 8: the contract does not check submission time itself,
 * so the server must refuse to release a task whose deadline has already
 * passed, even though the on-chain claim window might technically still
 * look valid.
 */
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
  if (!worker) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input", details: "body must be valid JSON" }, { status: 400 });
  }

  const parsed = submitTaskSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.issues }, { status: 400 });
  }

  const { id } = await params;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!task) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (task.status !== "claimed" || task.workerId !== worker.id) {
    return NextResponse.json({ error: "not_your_claim" }, { status: 409 });
  }

  if (Date.now() > task.deadlineAt) {
    // SPEC.md section 8: the server, not the contract, is the thing that
    // must refuse a late release. The sweeper (Phase 4) is what reopens or
    // refunds a task whose claim outlived the deadline; this route never
    // does that itself, it just refuses to pay out late.
    return NextResponse.json({ error: "deadline_passed" }, { status: 409 });
  }

  const answerSchema = answerSchemaByType[task.type];
  const answerParsed = answerSchema.safeParse(parsed.data.answer);
  if (!answerParsed.success) {
    return NextResponse.json(
      { error: "invalid_answer", details: answerParsed.error.issues },
      { status: 400 },
    );
  }

  if ((task.type === "verify_place" || task.type === "check_price") && !parsed.data.photo_key) {
    // SPEC.md section 10: a photo is required for these two types. Upload
    // itself is a real, working route now (see lib/cloudinary.ts); a
    // missing photo_key here means the client's own PhotoPicker never
    // completed an upload before submit, a client-input problem, not a
    // server capability gap.
    return NextResponse.json({ error: "photo_required" }, { status: 400 });
  }

  const submittedAt = Date.now();
  let submittedTask;
  try {
    submittedTask = await db.transaction(async (tx) => {
      const moved = await transition(tx, task, "submitted", { submittedAt });
      await tx.insert(submissions).values({
        id: ulid(),
        taskId: task.id,
        workerId: worker.id,
        answer: answerParsed.data,
        photoKey: parsed.data.photo_key ?? null,
        createdAt: submittedAt,
      });
      return moved;
    });
  } catch (err) {
    if (err instanceof ConcurrentTransitionError) {
      return NextResponse.json({ error: "not_your_claim" }, { status: 409 });
    }
    throw err;
  }

  // From here, the submission is durably saved regardless of what happens
  // next: a release() failure must not look like the worker's answer was
  // lost. Per SPEC.md section 9's failure table, the task simply stays
  // `submitted` for the sweeper to retry.
  try {
    const escrowConfig = escrowConfigFromEnv();
    const { txHash } = await escrowRelease(escrowConfig, taskIdToEscrowKey(task.id));
    const fee = Math.floor((task.price * FEE_BPS) / FEE_DENOMINATOR);
    await transition(db, submittedTask, "completed", { releaseTxHash: txHash });
    await db.update(tasks).set({ fee }).where(eq(tasks.id, task.id));
  } catch (err) {
    console.error("release failed after submission, leaving task submitted for the sweeper", err);
    return NextResponse.json({
      task_id: task.id,
      status: "submitted",
      note: "Saved. Payment is processing and may take a little longer.",
    });
  }

  return NextResponse.json({ task_id: task.id, status: "completed" });
}
