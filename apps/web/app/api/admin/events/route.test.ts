import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { taskEvents, tasks } from "@/lib/db/schema";
import type { TaskEventKind } from "@/lib/db/transition";
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
      status: "completed",
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

async function insertEvent(
  taskId: string,
  kind: TaskEventKind,
  overrides: Partial<typeof taskEvents.$inferInsert> = {},
) {
  const [row] = await testDb
    .insert(taskEvents)
    .values({
      id: ulid(),
      taskId,
      kind,
      data: {},
      createdAt: Date.now(),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

function eventsRequest(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `terreno_admin_session=${token}` } : {},
  });
}

describe("GET /api/admin/events", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no admin session cookie", async () => {
    const res = await GET(eventsRequest("/api/admin/events"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns an empty list when there are no events", async () => {
    const token = await signAdminSession({ admin: true });

    const res = await GET(eventsRequest("/api/admin/events", token));
    const body = await res.json();

    expect(body.events).toEqual([]);
  });

  it("builds a 'Task released' summary with net USDC for kind=released", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({ price: 5_000_000, fee: 500_000 });
    await insertEvent(task.id, "released");

    const res = await GET(eventsRequest("/api/admin/events", token));
    const body = await res.json();

    expect(body.events).toHaveLength(1);
    expect(body.events[0].kind).toBe("released");
    expect(body.events[0].summary).toBe("Task released · 0.45 USDC");
  });

  it("builds a 'Task refunded' summary with gross price USDC for kind=refunded", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({ status: "refunded", price: 3_000_000, fee: 300_000 });
    await insertEvent(task.id, "refunded");

    const res = await GET(eventsRequest("/api/admin/events", token));
    const body = await res.json();

    expect(body.events[0].kind).toBe("refunded");
    expect(body.events[0].summary).toBe("Task refunded · 0.30 USDC");
  });

  it("builds a non-empty, kind-appropriate summary for every one of the 10 real kind values", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({ type: "translate" });
    const allKinds: TaskEventKind[] = [
      "paid",
      "escrowed",
      "notified",
      "claimed",
      "claim_expired",
      "submitted",
      "released",
      "refunded",
      "policy_rejected",
      "failed",
    ];
    for (const kind of allKinds) {
      await insertEvent(task.id, kind);
    }

    const res = await GET(eventsRequest(`/api/admin/events?limit=${allKinds.length}`, token));
    const body = await res.json();

    expect(body.events).toHaveLength(allKinds.length);
    for (const event of body.events) {
      expect(typeof event.summary).toBe("string");
      expect(event.summary.length).toBeGreaterThan(0);
      // Every kind not covered by a price-based summary should still
      // surface the task type, so the row is informative even without a
      // dollar amount attached.
      if (!["released", "refunded", "paid", "escrowed"].includes(event.kind)) {
        expect(event.summary).toContain("translate");
      }
    }
  });

  it("orders events newest first", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({});
    const older = await insertEvent(task.id, "claimed", { createdAt: 1000 });
    const newer = await insertEvent(task.id, "submitted", { createdAt: 2000 });

    const res = await GET(eventsRequest("/api/admin/events", token));
    const body = await res.json();

    expect(body.events[0].id).toBe(newer.id);
    expect(body.events[1].id).toBe(older.id);
  });

  it("respects ?limit=", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({});
    await insertEvent(task.id, "claimed", { createdAt: 1000 });
    await insertEvent(task.id, "submitted", { createdAt: 2000 });
    await insertEvent(task.id, "released", { createdAt: 3000 });

    const res = await GET(eventsRequest("/api/admin/events?limit=2", token));
    const body = await res.json();

    expect(body.events).toHaveLength(2);
  });

  it("falls back to the default limit for an invalid ?limit= value", async () => {
    const token = await signAdminSession({ admin: true });
    const task = await insertTask({});
    await insertEvent(task.id, "claimed");

    const res = await GET(eventsRequest("/api/admin/events?limit=not_a_number", token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
  });
});
