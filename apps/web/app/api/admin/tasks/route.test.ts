import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks, workers } from "@/lib/db/schema";
import { signAdminSession } from "@/lib/admin-session";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname,
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

async function insertWorker(overrides: Partial<typeof workers.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(workers)
    .values({
      id: ulid(),
      displayName: "Chidi",
      walletAddress: `C${ulid()}`,
      passkeyCredentialId: ulid(),
      country: "NG",
      city: "enugu",
      languages: ["en"],
      status: "active",
      createdAt: Date.now(),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

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

function tasksRequest(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `terreno_admin_session=${token}` } : {},
  });
}

describe("GET /api/admin/tasks", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no admin session cookie", async () => {
    const res = await GET(tasksRequest("/api/admin/tasks"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns worker_display_name as null for an unclaimed task (left join, not inner)", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({ status: "open", workerId: null });

    const res = await GET(tasksRequest("/api/admin/tasks", token));
    const body = await res.json();

    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].task_id).toBe(task.id);
    expect(body.tasks[0].worker_display_name).toBeNull();
  });

  it("returns the real worker_display_name for a claimed task", async () => {
    const token = await signAdminSession({ admin: true });
    const worker = await insertWorker({ displayName: "Amara" });
    const task = await insertTask({ status: "claimed", workerId: worker.id });

    const res = await GET(tasksRequest("/api/admin/tasks", token));
    const body = await res.json();

    expect(body.tasks[0].task_id).toBe(task.id);
    expect(body.tasks[0].worker_display_name).toBe("Amara");
  });

  it("computes price_usdc/fee_usdc/net_usdc correctly from stroops", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "completed", price: 5_000_000, fee: 500_000 });

    const res = await GET(tasksRequest("/api/admin/tasks", token));
    const body = await res.json();

    expect(body.tasks[0].price_usdc).toBeCloseTo(0.5, 10);
    expect(body.tasks[0].fee_usdc).toBeCloseTo(0.05, 10);
    expect(body.tasks[0].net_usdc).toBeCloseTo(0.45, 10);
  });

  it("filters by a single status via ?status=", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "open" });
    const completed = await insertTask({ status: "completed" });

    const res = await GET(tasksRequest("/api/admin/tasks?status=completed", token));
    const body = await res.json();

    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].task_id).toBe(completed.id);
  });

  it("filters by multiple repeated ?status= params (multi-select)", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "open" });
    const completed = await insertTask({ status: "completed" });
    const refunded = await insertTask({ status: "refunded" });

    const res = await GET(
      tasksRequest("/api/admin/tasks?status=completed&status=refunded", token),
    );
    const body = await res.json();

    const ids = body.tasks.map((t: { task_id: string }) => t.task_id);
    expect(ids).toHaveLength(2);
    expect(ids).toContain(completed.id);
    expect(ids).toContain(refunded.id);
  });

  it("ignores an unknown status value rather than erroring", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "open" });

    const res = await GET(tasksRequest("/api/admin/tasks?status=not_a_real_status", token));

    // An unknown status value is dropped, leaving no filter at all, so all
    // tasks are returned rather than the request erroring.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
  });

  it("computes pagination math correctly: page 2 with pageSize 2 skips the first 2 of 5", async () => {
    const token = await signAdminSession({ admin: true });
    const base = Date.now();
    // 5 tasks, strictly increasing createdAt so ordering (newest first) is
    // deterministic: t5 (newest) .. t1 (oldest).
    const inserted = [];
    for (let i = 1; i <= 5; i++) {
      inserted.push(await insertTask({ createdAt: base + i * 1000, updatedAt: base + i * 1000 }));
    }
    const newestFirst = [...inserted].reverse(); // t5, t4, t3, t2, t1

    const res = await GET(tasksRequest("/api/admin/tasks?page=2&pageSize=2", token));
    const body = await res.json();

    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(2);
    expect(body.totalCount).toBe(5);
    // Page 1 would be [t5, t4]; page 2 skips those 2, returning [t3, t2].
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0].task_id).toBe(newestFirst[2]?.id);
    expect(body.tasks[1].task_id).toBe(newestFirst[3]?.id);
  });

  it("totalCount reflects the filtered count, not the unfiltered table count", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "open" });
    await insertTask({ status: "open" });
    await insertTask({ status: "completed" });

    const res = await GET(tasksRequest("/api/admin/tasks?status=completed", token));
    const body = await res.json();

    expect(body.totalCount).toBe(1);
  });

  it("falls back to default page/pageSize for invalid query values", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({});

    const res = await GET(tasksRequest("/api/admin/tasks?page=-1&pageSize=abc", token));
    const body = await res.json();

    expect(body.page).toBe(1);
    expect(body.pageSize).toBe(20);
  });

  it("returns an empty list with correct totalCount when no tasks exist", async () => {
    const token = await signAdminSession({ admin: true });

    const res = await GET(tasksRequest("/api/admin/tasks", token));
    const body = await res.json();

    expect(body.tasks).toEqual([]);
    expect(body.totalCount).toBe(0);
  });
});
