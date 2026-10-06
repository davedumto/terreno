import { NextRequest, NextResponse } from "next/server";
import { and, count, eq, gte, lt, lte, or, sql, sum, type SQL } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { requireAdminSession } from "@/lib/admin-session";

// "Current period" = the last 24h; "previous period" = the 24h before
// that. Chosen over, say, a 7-day window because this is a hackathon demo
// tool expected to be watched live during the event, where a 24h window is
// the smallest period still likely to contain >1 task as volume grows,
// without diluting a single day's activity across a longer lookback.
const PERIOD_MS = 24 * 60 * 60 * 1000;

interface Metric {
  count: number;
  deltaPct: number | null;
}

/**
 * A genuine "vs previous period" percentage, or null when the previous
 * period has no data to compare against (not just when both are zero): a
 * 0 -> 3 change is a real, infinite-ish jump that "0%" would misrepresent,
 * and a 0 -> 0 change has nothing to say at all. Both are left for the
 * caller (KpiCard, per the plan) to render as "no comparable data" rather
 * than a misleading number.
 */
function deltaPct(current: number, previous: number): number | null {
  if (previous === 0) {
    return null;
  }
  return ((current - previous) / previous) * 100;
}

/**
 * [since, until) by default — a half-open window so two adjacent periods
 * sharing a boundary (previous period's `until` == current period's
 * `since`) never double-count a row landing exactly on that instant.
 * `untilInclusive: true` closes the upper bound instead, needed only for
 * the outermost edge of the current period (`until = now`): Date.now()
 * has millisecond resolution, and a row's updatedAt can legitimately equal
 * the exact millisecond this handler's `now` was captured at (e.g. a
 * transition() call landing in the same tick as this request), which a
 * strict `lt` would wrongly exclude from "the last 24 hours" despite it
 * having happened within that window.
 */
async function countInWindow(
  statusFilter: SQL,
  dateColumn: typeof tasks.updatedAt | typeof tasks.createdAt,
  since: number,
  until: number,
  untilInclusive = false,
): Promise<number> {
  const upperBound = untilInclusive ? lte(dateColumn, until) : lt(dateColumn, until);
  const [row] = await db
    .select({ value: count() })
    .from(tasks)
    .where(and(statusFilter, gte(dateColumn, since), upperBound));
  return row?.value ?? 0;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireAdminSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const now = Date.now();
  const currentSince = now - PERIOD_MS;
  const previousSince = now - 2 * PERIOD_MS;

  const completedFilter = eq(tasks.status, "completed");
  // or() types as SQL | undefined in general (it returns undefined only
  // when called with zero defined conditions), but these two eq() calls
  // are always-defined literals, so the result is always a real SQL node.
  const pendingFilter = or(eq(tasks.status, "open"), eq(tasks.status, "claimed")) as SQL;
  const refundedFilter = eq(tasks.status, "refunded");

  // completed/refunded are measured against updatedAt: that's the moment a
  // task actually reached that terminal status. pending is measured
  // against createdAt: a task is "pending" for a span of time, not a
  // single moment, so "how many entered the pending-eligible state in this
  // window" (createdAt) is the meaningful count, not its ever-changing
  // updatedAt.
  const [
    completedCurrent,
    completedPrevious,
    pendingCurrent,
    pendingPrevious,
    refundedCurrent,
    refundedPrevious,
    volumeCurrentRow,
    volumePreviousRow,
  ] = await Promise.all([
    countInWindow(completedFilter, tasks.updatedAt, currentSince, now, true),
    countInWindow(completedFilter, tasks.updatedAt, previousSince, currentSince),
    countInWindow(pendingFilter, tasks.createdAt, currentSince, now, true),
    countInWindow(pendingFilter, tasks.createdAt, previousSince, currentSince),
    countInWindow(refundedFilter, tasks.updatedAt, currentSince, now, true),
    countInWindow(refundedFilter, tasks.updatedAt, previousSince, currentSince),
    db
      .select({ value: sum(sql`${tasks.price} - ${tasks.fee}`) })
      .from(tasks)
      .where(and(completedFilter, gte(tasks.updatedAt, currentSince), lte(tasks.updatedAt, now))),
    db
      .select({ value: sum(sql`${tasks.price} - ${tasks.fee}`) })
      .from(tasks)
      .where(
        and(
          completedFilter,
          gte(tasks.updatedAt, previousSince),
          lt(tasks.updatedAt, currentSince),
        ),
      ),
  ]);

  const volumeCurrentStroops = Number(volumeCurrentRow[0]?.value ?? 0);
  const volumePreviousStroops = Number(volumePreviousRow[0]?.value ?? 0);

  const completed: Metric = {
    count: completedCurrent,
    deltaPct: deltaPct(completedCurrent, completedPrevious),
  };
  const pending: Metric = {
    count: pendingCurrent,
    deltaPct: deltaPct(pendingCurrent, pendingPrevious),
  };
  const refunded: Metric = {
    count: refundedCurrent,
    deltaPct: deltaPct(refundedCurrent, refundedPrevious),
  };
  const volumeUsdc = {
    amount: volumeCurrentStroops / STROOPS_PER_USDC,
    deltaPct: deltaPct(volumeCurrentStroops, volumePreviousStroops),
  };

  return NextResponse.json({ completed, pending, refunded, volumeUsdc });
}
