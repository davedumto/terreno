import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks } from "@/lib/db/schema";
import { signAdminSession } from "@/lib/admin-session";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../../../../lib/db/migrations", import.meta.url).pathname,
  });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-admin-session-secret-at-least-32-bytes");
});

async function insertTask(overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const now = Date.now();
  const [row] = await testDb
    .insert(tasks)
    .values({
      id: ulid(),
      type: "verify_place",
      status: "open",
      input: {},
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 500_000,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      taskTokenHash: "hash",
      deadlineAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

function kpisRequest(token?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/admin/kpis", {
    headers: token ? { cookie: `terreno_admin_session=${token}` } : {},
  });
}

describe("GET /api/admin/kpis", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no admin session cookie", async () => {
    const res = await GET(kpisRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("rejects a request with an invalid admin session cookie", async () => {
    const res = await GET(kpisRequest("not-a-real-jwt"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns all-zero metrics and null deltas with an empty database", async () => {
    const token = await signAdminSession({ admin: true });
    const res = await GET(kpisRequest(token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      completed: { count: 0, deltaPct: null },
      pending: { count: 0, deltaPct: null },
      refunded: { count: 0, deltaPct: null },
      volumeUsdc: { amount: 0, deltaPct: null },
    });
  });

  it("counts completed/pending/refunded correctly and computes volumeUsdc from price-fee", async () => {
    const now = Date.now();
    const token = await signAdminSession({ admin: true });

    // 1 completed task in the current 24h window: price 5_000_000 stroops,
    // fee 500_000 stroops -> net 4_500_000 stroops = 0.45 USDC.
    await insertTask({ status: "completed", price: 5_000_000, fee: 500_000, updatedAt: now });
    // 2 pending tasks (one open, one claimed), both created "now".
    await insertTask({ status: "open", createdAt: now, updatedAt: now });
    await insertTask({ status: "claimed", createdAt: now, updatedAt: now });
    // 1 refunded task.
    await insertTask({ status: "refunded", updatedAt: now });
    // A paid task should count toward neither completed, pending, nor
    // refunded (it's its own distinct status).
    await insertTask({ status: "paid", createdAt: now, updatedAt: now });

    const res = await GET(kpisRequest(token));
    const body = await res.json();

    expect(body.completed.count).toBe(1);
    expect(body.pending.count).toBe(2);
    expect(body.refunded.count).toBe(1);
    expect(body.volumeUsdc.amount).toBeCloseTo(0.45, 10);
  });

  it("deltaPct is null when the previous period has zero data, even with current-period data present", async () => {
    const now = Date.now();
    const token = await signAdminSession({ admin: true });

    // Only a current-period completed task; nothing in the prior 24-48h window.
    await insertTask({ status: "completed", updatedAt: now });

    const res = await GET(kpisRequest(token));
    const body = await res.json();

    expect(body.completed.count).toBe(1);
    expect(body.completed.deltaPct).toBeNull();
  });

  it("computes a real, non-null deltaPct when both periods have data", async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const token = await signAdminSession({ admin: true });

    // Previous period (24-48h ago): 1 completed task.
    await insertTask({ status: "completed", updatedAt: now - oneDayMs - 1000 });
    // Current period (last 24h): 2 completed tasks -> +100% vs previous.
    await insertTask({ status: "completed", updatedAt: now });
    await insertTask({ status: "completed", updatedAt: now - 1000 });

    const res = await GET(kpisRequest(token));
    const body = await res.json();

    expect(body.completed.count).toBe(2);
    expect(body.completed.deltaPct).toBeCloseTo(100, 10);
  });

  it("excludes a completed task updated outside the current 24h window from the current count", async () => {
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;
    const token = await signAdminSession({ admin: true });

    // Updated 3 days ago: outside both the current and previous 24h windows.
    await insertTask({ status: "completed", updatedAt: now - 3 * oneDayMs });

    const res = await GET(kpisRequest(token));
    const body = await res.json();

    expect(body.completed.count).toBe(0);
    expect(body.completed.deltaPct).toBeNull();
  });
});
