import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks, workers, taskEvents } from "@/lib/db/schema";
import { signSession } from "@/lib/session";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../../../../../../lib/db/migrations", import.meta.url).pathname,
  });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const assignMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "ASSIGNTX1" }));

vi.mock("@/lib/escrow", () => ({
  assign: (...args: unknown[]) => assignMock(...args),
  escrowConfigFromEnv: () => ({
    contractId: "C_TEST",
    rpcUrl: "https://example.test",
    networkPassphrase: "Test",
    adminSecretKey: "S_TEST",
    treasurySecretKey: "S_TEST",
  }),
  taskIdToEscrowKey: (taskId: string) => Buffer.from(taskId),
}));

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
  assignMock.mockClear();
  assignMock.mockResolvedValue({ txHash: "ASSIGNTX1" });
});

async function insertWorker(overrides: Partial<typeof workers.$inferInsert> = {}): Promise<
  typeof workers.$inferSelect
> {
  const [row] = await testDb
    .insert(workers)
    .values({
      id: ulid(),
      displayName: "Test Worker",
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

async function insertOpenTask(
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<typeof tasks.$inferSelect> {
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
      fee: 500_000,
      payerAddress: "GPAYERADDRESS",
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

async function claimRequest(taskId: string, token?: string): Promise<NextRequest> {
  return new NextRequest(`${APP_URL}/api/worker/tasks/${taskId}/claim`, {
    method: "POST",
    headers: {
      origin: APP_URL,
      ...(token ? { cookie: `terreno_session=${token}` } : {}),
    },
  });
}

function postParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("POST /api/worker/tasks/[id]/claim", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("claims an open task for a signed-in worker", async () => {
    const worker = await insertWorker();
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task_id).toBe(task.id);
    expect(body.status).toBe("claimed");
    expect(assignMock).toHaveBeenCalledTimes(1);

    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("claimed");
    expect(reloaded?.workerId).toBe(worker.id);

    const events = await testDb.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("claimed");
  });

  it("rejects a request with no Origin header", async () => {
    const worker = await insertWorker();
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const req = new NextRequest(`${APP_URL}/api/worker/tasks/${task.id}/claim`, {
      method: "POST",
      headers: { cookie: `terreno_session=${token}` },
    });

    const res = await POST(req, postParams(task.id));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("rejects a request from a different Origin", async () => {
    const worker = await insertWorker();
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const req = new NextRequest(`${APP_URL}/api/worker/tasks/${task.id}/claim`, {
      method: "POST",
      headers: { origin: "http://evil.example", cookie: `terreno_session=${token}` },
    });

    const res = await POST(req, postParams(task.id));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("rejects a request with no session cookie", async () => {
    const task = await insertOpenTask();

    const res = await POST(await claimRequest(task.id), postParams(task.id));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("rejects a session for a paused worker", async () => {
    const worker = await insertWorker({ status: "paused" });
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("rejects a session for a worker id that no longer exists", async () => {
    const task = await insertOpenTask();
    const token = await signSession({ workerId: ulid() });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("returns 404 for a nonexistent task id", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest("does-not-exist", token), postParams("does-not-exist"));

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("returns 409 not_open for a task that is not open, naming its real status", async () => {
    const worker = await insertWorker();
    const task = await insertOpenTask({ status: "paid", escrowTxHash: null });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("not_open");
    expect(body.status).toBe("paid");
  });

  it("returns 409 already_claimed when another worker's claim already won", async () => {
    const otherWorker = await insertWorker();
    const worker = await insertWorker();
    const task = await insertOpenTask({
      status: "claimed",
      workerId: otherWorker.id,
      claimedAt: Date.now(),
      claimExpiresAt: Date.now() + 1000,
    });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_open");
  });

  function validTranslateInput(targetLanguage: string) {
    return {
      location: { country: "NG", city: "enugu" },
      source_text: "hello",
      target_language: targetLanguage,
      deadline_minutes: 60,
    };
  }

  it("returns 403 language_mismatch for a translate task the worker's languages don't cover", async () => {
    const worker = await insertWorker({ languages: ["en"] });
    const task = await insertOpenTask({
      type: "translate",
      input: validTranslateInput("fr"),
    });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("language_mismatch");
    expect(assignMock).not.toHaveBeenCalled();

    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("open");
  });

  it("returns 403 language_mismatch for a translate task with malformed input, not a 500", async () => {
    const worker = await insertWorker({ languages: ["fr"] });
    const task = await insertOpenTask({
      type: "translate",
      // Missing location/deadline_minutes: a row that should never exist
      // given the schema validation at task-creation time, but the claim
      // route must still fail closed rather than crash if it somehow does.
      input: { source_text: "hello", target_language: "fr" },
    });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("language_mismatch");
  });

  it("allows a translate task when the worker's languages include the target", async () => {
    const worker = await insertWorker({ languages: ["en", "fr"] });
    const task = await insertOpenTask({
      type: "translate",
      input: validTranslateInput("fr"),
    });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(200);
  });

  it("returns 409 already_holding_a_claim when the worker already holds a different claim", async () => {
    const worker = await insertWorker();
    const heldTask = await insertOpenTask({
      status: "claimed",
      workerId: worker.id,
      claimedAt: Date.now(),
      claimExpiresAt: Date.now() + 1000,
    });
    const newTask = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(newTask.id, token), postParams(newTask.id));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_holding_a_claim");
    expect(assignMock).not.toHaveBeenCalled();

    const [reloadedHeld] = await testDb.select().from(tasks).where(eq(tasks.id, heldTask.id));
    expect(reloadedHeld?.status).toBe("claimed");
    const [reloadedNew] = await testDb.select().from(tasks).where(eq(tasks.id, newTask.id));
    expect(reloadedNew?.status).toBe("open");
  });

  it("rolls the claim back to open and returns try_again when assign() fails", async () => {
    assignMock.mockRejectedValueOnce(new Error("rpc timeout"));
    const worker = await insertWorker();
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const res = await POST(await claimRequest(task.id, token), postParams(task.id));

    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("try_again");

    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("open");
    expect(reloaded?.workerId).toBeNull();
    expect(reloaded?.claimedAt).toBeNull();
    expect(reloaded?.claimExpiresAt).toBeNull();

    // Two events: the claim itself, then the rollback logged as "failed"
    // (not "claim_expired", since this isn't a real 15-minute timeout).
    const events = await testDb
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, task.id))
      .orderBy(taskEvents.createdAt);
    expect(events.map((e) => e.kind)).toEqual(["claimed", "failed"]);
  });

  it("lets a worker claim again after a rolled-back assign failure", async () => {
    assignMock.mockRejectedValueOnce(new Error("rpc timeout"));
    const worker = await insertWorker();
    const task = await insertOpenTask();
    const token = await signSession({ workerId: worker.id });

    const first = await POST(await claimRequest(task.id, token), postParams(task.id));
    expect(first.status).toBe(502);

    const second = await POST(await claimRequest(task.id, token), postParams(task.id));
    expect(second.status).toBe(200);
    expect(assignMock).toHaveBeenCalledTimes(2);
  });
});
