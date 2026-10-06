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
    migrationsFolder: new URL("../../../../../lib/db/migrations", import.meta.url).pathname,
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
      input: { question: "Is it open?" },
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 0,
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

function detailRequest(id: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost:3000/api/worker/tasks/${id}`, {
    headers: token ? { cookie: `terreno_session=${token}` } : {},
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("GET /api/worker/tasks/[id]", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no session cookie", async () => {
    const task = await insertTask();
    const res = await GET(detailRequest(task.id), routeParams(task.id));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent task id", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });
    const res = await GET(detailRequest("does-not-exist", token), routeParams("does-not-exist"));
    expect(res.status).toBe(404);
  });

  it("returns an open task's detail to any signed-in worker, is_own_claim false", async () => {
    const worker = await insertWorker();
    const task = await insertTask();
    const token = await signSession({ workerId: worker.id });

    const res = await GET(detailRequest(task.id, token), routeParams(task.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task_id).toBe(task.id);
    expect(body.status).toBe("open");
    expect(body.is_own_claim).toBe(false);
    expect(body.input.question).toBe("Is it open?");
  });

  it("returns a worker's own claimed task, is_own_claim true", async () => {
    const worker = await insertWorker();
    const task = await insertTask({
      status: "claimed",
      workerId: worker.id,
      claimedAt: Date.now(),
      claimExpiresAt: Date.now() + 1000,
    });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(detailRequest(task.id, token), routeParams(task.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.is_own_claim).toBe(true);
  });

  it("returns 404 for a task another worker has claimed (not open, not theirs)", async () => {
    const otherWorker = await insertWorker();
    const worker = await insertWorker();
    const task = await insertTask({
      status: "claimed",
      workerId: otherWorker.id,
      claimedAt: Date.now(),
      claimExpiresAt: Date.now() + 1000,
    });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(detailRequest(task.id, token), routeParams(task.id));

    expect(res.status).toBe(404);
  });

  it("includes a release tx link for a completed task that is the worker's own", async () => {
    const worker = await insertWorker();
    const task = await insertTask({
      status: "completed",
      workerId: worker.id,
      releaseTxHash: "RELEASETX1",
    });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(detailRequest(task.id, token), routeParams(task.id));
    const body = await res.json();

    expect(body.release_tx).toContain("RELEASETX1");
  });
});
