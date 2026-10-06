import { NextRequest, NextResponse } from "next/server";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks } from "@/lib/db/schema";
import { requireAdminSession } from "@/lib/admin-session";

const RANGES = ["24h", "7d", "30d"] as const;
type Range = (typeof RANGES)[number];

const RANGE_MS: Record<Range, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

// strftime's bucket format: hourly buckets for the 24h view (fine enough
// granularity to show same-day movement), daily buckets for 7d/30d
// (hourly would be too many points to read as a trend line).
const BUCKET_FORMAT: Record<Range, string> = {
  "24h": "%Y-%m-%dT%H:00",
  "7d": "%Y-%m-%d",
  "30d": "%Y-%m-%d",
};

function isRange(value: string | null): value is Range {
  return value !== null && (RANGES as readonly string[]).includes(value);
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireAdminSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const rawRange = req.nextUrl.searchParams.get("range");
  const range: Range = isRange(rawRange) ? rawRange : "24h";
  const since = Date.now() - RANGE_MS[range];
  const format = BUCKET_FORMAT[range];

  // updatedAt is a millisecond-epoch integer (same column transition.ts
  // writes via Date.now()); strftime's unixepoch modifier expects seconds,
  // so divide by 1000 first — same raw-sql escape-hatch style as
  // lib/reputation.ts's json_extract() call (a plain `sql` template, not a
  // query-builder helper, because Drizzle's sqlite-core has no typed
  // strftime/date-bucketing helper).
  const bucket = sql<string>`strftime(${format}, ${tasks.updatedAt} / 1000, 'unixepoch')`;

  const rows = await db
    .select({
      date: bucket,
      volumeStroops: sql<number>`sum(${tasks.price} - ${tasks.fee})`,
    })
    .from(tasks)
    .where(and(eq(tasks.status, "completed"), gte(tasks.updatedAt, since)))
    .groupBy(bucket)
    .orderBy(asc(bucket));

  return NextResponse.json({
    points: rows.map((row) => ({
      date: row.date,
      volumeUsdc: Number(row.volumeStroops) / STROOPS_PER_USDC,
    })),
  });
}
