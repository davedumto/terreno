import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { taskEvents, tasks } from "@/lib/db/schema";
import { requireAdminSession } from "@/lib/admin-session";

const DEFAULT_LIMIT = 20;

type TaskEventKind = (typeof taskEvents.$inferSelect)["kind"];

interface SummaryContext {
  taskType: string;
  priceUsdc: number;
  netUsdc: number;
}

/**
 * Builds a human-readable summary per lib/db/transition.ts's full 10-value
 * kind enum. Only escrowed/claimed/claim_expired/submitted/released/
 * refunded are ever actually written today (transition()'s RULES table is
 * the only writer); paid/notified/policy_rejected/failed have no current
 * writer in this codebase, but the schema's CHECK constraint allows them,
 * so a future writer landing without a matching update here would silently
 * fall through to the generic fallback below rather than crash — handled
 * explicitly anyway so the dashboard reads correctly the day one of those
 * is wired up.
 */
function buildSummary(kind: TaskEventKind, ctx: SummaryContext): string {
  switch (kind) {
    case "paid":
      return `Task paid · ${ctx.priceUsdc.toFixed(2)} USDC`;
    case "escrowed":
      return `Task escrowed · ${ctx.priceUsdc.toFixed(2)} USDC`;
    case "notified":
      return `Worker notified · ${ctx.taskType}`;
    case "claimed":
      return `Task claimed · ${ctx.taskType}`;
    case "claim_expired":
      return `Claim expired · ${ctx.taskType}`;
    case "submitted":
      return `Task submitted · ${ctx.taskType}`;
    case "released":
      return `Task released · ${ctx.netUsdc.toFixed(2)} USDC`;
    case "refunded":
      return `Task refunded · ${ctx.priceUsdc.toFixed(2)} USDC`;
    case "policy_rejected":
      return `Submission rejected · ${ctx.taskType}`;
    case "failed":
      return `Task failed · ${ctx.taskType}`;
    default:
      // Exhaustiveness guard: TaskEventKind is a closed union matching the
      // schema's CHECK constraint, so this is unreachable at the type
      // level. Kept as a real runtime fallback (not a `never` cast) in
      // case the DB ever contains a kind the current enum doesn't list,
      // e.g. after a future migration this code hasn't been updated for.
      return `Task event · ${String(kind)}`;
  }
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireAdminSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const limit = (() => {
    const raw = req.nextUrl.searchParams.get("limit");
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
  })();

  const rows = await db
    .select({
      id: taskEvents.id,
      task_id: taskEvents.taskId,
      kind: taskEvents.kind,
      created_at: taskEvents.createdAt,
      task_type: tasks.type,
      price: tasks.price,
      fee: tasks.fee,
    })
    .from(taskEvents)
    .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
    .orderBy(desc(taskEvents.createdAt))
    .limit(limit);

  return NextResponse.json({
    events: rows.map((row) => ({
      id: row.id,
      task_id: row.task_id,
      kind: row.kind,
      created_at: new Date(row.created_at).toISOString(),
      summary: buildSummary(row.kind, {
        taskType: row.task_type,
        priceUsdc: row.price / STROOPS_PER_USDC,
        netUsdc: (row.price - row.fee) / STROOPS_PER_USDC,
      }),
    })),
  });
}
