import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest): Promise<Response> {
  const session = await getSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const [worker] = await db.select().from(workers).where(eq(workers.id, session.workerId));
  if (!worker) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  // SPEC.md section 10: open tasks in the worker's own city, newest first.
  const openTasks = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.status, "open"), eq(tasks.country, worker.country), eq(tasks.city, worker.city)),
    )
    .orderBy(desc(tasks.createdAt));

  return NextResponse.json({
    tasks: openTasks.map((task) => ({
      task_id: task.id,
      type: task.type,
      price_usdc: task.price / STROOPS_PER_USDC,
      deadline_at: new Date(task.deadlineAt).toISOString(),
      created_at: new Date(task.createdAt).toISOString(),
    })),
  });
}
