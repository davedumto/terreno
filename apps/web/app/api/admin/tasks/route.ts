import { NextRequest, NextResponse } from "next/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { STROOPS_PER_USDC } from "@terreno/shared";
import { db } from "@/lib/db";
import { tasks, workers } from "@/lib/db/schema";
import { requireAdminSession } from "@/lib/admin-session";

const TASK_STATUSES = ["paid", "open", "claimed", "submitted", "completed", "refunded"] as const;
type TaskStatus = (typeof TASK_STATUSES)[number];

const DEFAULT_PAGE_SIZE = 20;

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function parsePositiveInt(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export async function GET(req: NextRequest): Promise<Response> {
  const session = await requireAdminSession(req);
  if (!session) {
    return NextResponse.json({ error: "not_signed_in" }, { status: 401 });
  }

  const searchParams = req.nextUrl.searchParams;
  const page = parsePositiveInt(searchParams.get("page"), 1);
  const pageSize = parsePositiveInt(searchParams.get("pageSize"), DEFAULT_PAGE_SIZE);

  // Repeated query params for multi-select status filtering, e.g.
  // ?status=completed&status=refunded. Unknown values are dropped rather
  // than erroring, since this backs a UI-driven filter chip set, not a
  // strict API contract.
  const statusValues = searchParams.getAll("status").filter(isTaskStatus);
  const statusFilter = statusValues.length > 0 ? inArray(tasks.status, statusValues) : undefined;

  const offset = (page - 1) * pageSize;

  const [rows, totalCountRow] = await Promise.all([
    db
      .select({
        task_id: tasks.id,
        type: tasks.type,
        status: tasks.status,
        price: tasks.price,
        fee: tasks.fee,
        country: tasks.country,
        city: tasks.city,
        worker_display_name: workers.displayName,
        created_at: tasks.createdAt,
        updated_at: tasks.updatedAt,
      })
      .from(tasks)
      .leftJoin(workers, eq(tasks.workerId, workers.id))
      .where(statusFilter)
      .orderBy(desc(tasks.createdAt))
      .limit(pageSize)
      .offset(offset),
    db
      .select({ value: count() })
      .from(tasks)
      .where(statusFilter),
  ]);

  const totalCount = totalCountRow[0]?.value ?? 0;

  return NextResponse.json({
    tasks: rows.map((row) => ({
      task_id: row.task_id,
      type: row.type,
      status: row.status,
      price_usdc: row.price / STROOPS_PER_USDC,
      fee_usdc: row.fee / STROOPS_PER_USDC,
      net_usdc: (row.price - row.fee) / STROOPS_PER_USDC,
      country: row.country,
      city: row.city,
      worker_display_name: row.worker_display_name ?? null,
      created_at: new Date(row.created_at).toISOString(),
      updated_at: new Date(row.updated_at).toISOString(),
    })),
    page,
    pageSize,
    totalCount,
  });
}
