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

function volumeRequest(path: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: token ? { cookie: `terreno_admin_session=${token}` } : {},
  });
}

describe("GET /api/admin/volume", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no admin session cookie", async () => {
    const res = await GET(volumeRequest("/api/admin/volume?range=24h"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns an empty points array, not an error, when no completed tasks exist in range", async () => {
    const token = await signAdminSession({ admin: true });

    const res = await GET(volumeRequest("/api/admin/volume?range=24h", token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toEqual([]);
  });

  it("buckets a single completed task into one point with the correct volumeUsdc", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "completed", price: 5_000_000, fee: 500_000 });

    const res = await GET(volumeRequest("/api/admin/volume?range=24h", token));
    const body = await res.json();

    expect(body.points).toHaveLength(1);
    expect(body.points[0].volumeUsdc).toBeCloseTo(0.45, 10);
    expect(typeof body.points[0].date).toBe("string");
  });

  it("excludes a completed task updated outside the requested range", async () => {
    const token = await signAdminSession({ admin: true });
    const now = Date.now();
    const eightDaysMs = 8 * 24 * 60 * 60 * 1000;
    await insertTask({ status: "completed", updatedAt: now - eightDaysMs });

    const res = await GET(volumeRequest("/api/admin/volume?range=7d", token));
    const body = await res.json();

    expect(body.points).toEqual([]);
  });

  it("excludes a non-completed task from volume even within range", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "open" });

    const res = await GET(volumeRequest("/api/admin/volume?range=24h", token));
    const body = await res.json();

    expect(body.points).toEqual([]);
  });

  it("aggregates two completed tasks in the same hour into a single 24h bucket", async () => {
    const token = await signAdminSession({ admin: true });
    const now = Date.now();
    await insertTask({ status: "completed", price: 5_000_000, fee: 500_000, updatedAt: now });
    await insertTask({ status: "completed", price: 3_000_000, fee: 300_000, updatedAt: now - 1000 });

    const res = await GET(volumeRequest("/api/admin/volume?range=24h", token));
    const body = await res.json();

    expect(body.points).toHaveLength(1);
    // (5_000_000 - 500_000 + 3_000_000 - 300_000) / 10_000_000 = 0.72 USDC.
    expect(body.points[0].volumeUsdc).toBeCloseTo(0.72, 10);
  });

  it("defaults to a 24h range when ?range= is omitted", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "completed" });

    const res = await GET(volumeRequest("/api/admin/volume", token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toHaveLength(1);
  });

  it("falls back to 24h for an invalid ?range= value rather than erroring", async () => {
    const token = await signAdminSession({ admin: true });
    await insertTask({ status: "completed" });

    const res = await GET(volumeRequest("/api/admin/volume?range=invalid", token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.points).toHaveLength(1);
  });
});
