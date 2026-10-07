import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks, workers } from "@/lib/db/schema";
import { signSession } from "@/lib/session";

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
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
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
      escrowTxHash: "ESCROWTX1",
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

function listRequest(token?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/worker/tasks", {
    headers: token ? { cookie: `terreno_session=${token}` } : {},
  });
}

describe("GET /api/worker/tasks", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no session cookie", async () => {
    const res = await GET(listRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns an empty list when there are no open tasks", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));

    expect(res.status).toBe(200);
    expect((await res.json()).tasks).toEqual([]);
  });

  it("returns open tasks in the worker's own city", async () => {
    const worker = await insertWorker({ country: "NG", city: "enugu" });
    const task = await insertTask({ country: "NG", city: "enugu" });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));
    const body = await res.json();

    expect(body.tasks).toHaveLength(1);
    expect(body.tasks[0].task_id).toBe(task.id);
    expect(body.tasks[0].price_usdc).toBeCloseTo(0.5, 10);
  });

  it("excludes tasks in a different city", async () => {
    const worker = await insertWorker({ country: "NG", city: "enugu" });
    await insertTask({ country: "NG", city: "lagos" });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));
    const body = await res.json();

    expect(body.tasks).toEqual([]);
  });

  it("excludes tasks in a different country, even the same city name", async () => {
    const worker = await insertWorker({ country: "NG", city: "enugu" });
    await insertTask({ country: "CL", city: "enugu" });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));
    const body = await res.json();

    expect(body.tasks).toEqual([]);
  });

  it("excludes a task that is not open", async () => {
    const worker = await insertWorker({ country: "NG", city: "enugu" });
    await insertTask({ country: "NG", city: "enugu", status: "claimed", workerId: worker.id });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));
    const body = await res.json();

    expect(body.tasks).toEqual([]);
  });

  it("orders tasks newest first", async () => {
    const worker = await insertWorker({ country: "NG", city: "enugu" });
    const older = await insertTask({ country: "NG", city: "enugu", createdAt: 1000 });
    const newer = await insertTask({ country: "NG", city: "enugu", createdAt: 2000 });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(listRequest(token));
    const body = await res.json();

    expect(body.tasks[0].task_id).toBe(newer.id);
    expect(body.tasks[1].task_id).toBe(older.id);
  });
});
