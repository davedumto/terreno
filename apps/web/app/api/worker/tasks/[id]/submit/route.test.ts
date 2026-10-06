import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { submissions, taskEvents, tasks, workers } from "@/lib/db/schema";
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

const releaseMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "RELEASETX1" }));

vi.mock("@/lib/escrow", () => ({
  release: (...args: unknown[]) => releaseMock(...args),
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
  releaseMock.mockClear();
  releaseMock.mockResolvedValue({ txHash: "RELEASETX1" });
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

async function insertClaimedTask(
  workerId: string,
  overrides: Partial<typeof tasks.$inferInsert> = {},
) {
  const now = Date.now();
  const [row] = await testDb
    .insert(tasks)
    .values({
      id: ulid(),
      type: "verify_place",
      status: "claimed",
      input: { question: "Is it open?" },
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 0,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      escrowTxHash: "ESCROWTX1",
      taskTokenHash: "hash",
      workerId,
      claimedAt: now,
      claimExpiresAt: now + 15 * 60 * 1000,
      deadlineAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

function submitRequest(id: string, body: unknown, token?: string): NextRequest {
  return new NextRequest(`${APP_URL}/api/worker/tasks/${id}/submit`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: APP_URL,
      ...(token ? { cookie: `terreno_session=${token}` } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

const VERIFY_PLACE_ANSWER = { exists: "yes", open_now: "yes", notes: "looks open" };

describe("POST /api/worker/tasks/[id]/submit", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("saves the submission, releases, and marks the task completed", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "photos/x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("completed");

    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("completed");
    expect(reloaded?.releaseTxHash).toBe("RELEASETX1");
    expect(reloaded?.fee).toBe(500_000); // 5_000_000 * 1000 / 10000

    const [submission] = await testDb
      .select()
      .from(submissions)
      .where(eq(submissions.taskId, task.id));
    expect(submission?.workerId).toBe(worker.id);
    expect((submission?.answer as typeof VERIFY_PLACE_ANSWER).exists).toBe("yes");

    const events = await testDb.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    expect(events.map((e) => e.kind).sort()).toEqual(["released", "submitted"]);
  });

  it("rejects a request with no Origin header", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });
    const req = new NextRequest(`${APP_URL}/api/worker/tasks/${task.id}/submit`, {
      method: "POST",
      headers: { cookie: `terreno_session=${token}` },
      body: JSON.stringify({ answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }),
    });

    const res = await POST(req, routeParams(task.id));
    expect(res.status).toBe(403);
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("rejects a request with no session cookie", async () => {
    const task = await insertClaimedTask((await insertWorker()).id);
    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }),
      routeParams(task.id),
    );
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent task id", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });
    const res = await POST(
      submitRequest("does-not-exist", { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }, token),
      routeParams("does-not-exist"),
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 not_your_claim for a task claimed by a different worker", async () => {
    const otherWorker = await insertWorker();
    const worker = await insertWorker();
    const task = await insertClaimedTask(otherWorker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_your_claim");
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("returns 409 not_your_claim for a task that is not claimed at all (e.g. still open)", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id, { status: "open", workerId: null });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(409);
  });

  it("returns 409 deadline_passed and does not transition or release when the deadline is past", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id, { deadlineAt: Date.now() - 1000 });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("deadline_passed");
    expect(releaseMock).not.toHaveBeenCalled();
    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("claimed");
  });

  it("returns 400 invalid_answer for an answer missing required fields for the task's type", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: { notes: "only notes, missing exists/open_now" }, photo_key: "x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_answer");
  });

  it("returns 503 when a photo is required but not provided (verify_place)", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("photo_required_not_yet_available");
    expect(releaseMock).not.toHaveBeenCalled();
  });

  it("does not require a photo for translate", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id, {
      type: "translate",
      input: { source_text: "hello" },
    });
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: { translation: "bonjour" } }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(200);
  });

  it("saves the submission but leaves the task submitted (not completed) when release fails", async () => {
    releaseMock.mockRejectedValue(new Error("rpc timeout"));
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(
      submitRequest(task.id, { answer: VERIFY_PLACE_ANSWER, photo_key: "x.jpg" }, token),
      routeParams(task.id),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("submitted");

    const [reloaded] = await testDb.select().from(tasks).where(eq(tasks.id, task.id));
    expect(reloaded?.status).toBe("submitted");
    expect(reloaded?.releaseTxHash).toBeNull();

    // The submission itself must still be saved: the worker's answer is
    // never lost just because the on-chain payout hasn't gone through yet.
    const [submission] = await testDb
      .select()
      .from(submissions)
      .where(eq(submissions.taskId, task.id));
    expect(submission).toBeDefined();
  });
});
