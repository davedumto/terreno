import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { and, eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "@terreno/shared/db/schema";
import { tasks, taskEvents, workers } from "@terreno/shared/db/schema";

const createTaskMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "ESCROWTX1" }));
const unassignMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "UNASSIGNTX1" }));
const refundMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "REFUNDTX1" }));
const releaseMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "RELEASETX1" }));

vi.mock("@terreno/shared/escrow", () => ({
  createTask: (...args: unknown[]) => createTaskMock(...args),
  unassign: (...args: unknown[]) => unassignMock(...args),
  refund: (...args: unknown[]) => refundMock(...args),
  release: (...args: unknown[]) => releaseMock(...args),
  taskIdToEscrowKey: (taskId: string) => Buffer.from(taskId),
  escrowConfigFromEnv: () => ({
    contractId: "C_TEST",
    rpcUrl: "https://example.test",
    networkPassphrase: "Test",
    adminSecretKey: "S_TEST",
    treasurySecretKey: "S_TEST",
  }),
}));

// Typed with real positional params (not `unknown[]`), so a later
// `.mock.calls[0]` destructure gets the actual argument types back instead
// of `unknown` -- same reasoning as apps/web/lib/create-paid-task.test.ts's
// identically-shaped mocks.
const notifyWorkersOfTaskMock = vi.fn(
  async (
    _db: unknown,
    _bot: unknown,
    _task: typeof tasks.$inferSelect,
    _matchedWorkers: Array<typeof workers.$inferSelect>,
  ) => undefined,
);

vi.mock("@terreno/shared/telegram", () => ({
  getBot: () => ({ api: {} }),
  notifyWorkersOfTask: (
    db: unknown,
    bot: unknown,
    task: typeof tasks.$inferSelect,
    matchedWorkers: Array<typeof workers.$inferSelect>,
  ) => notifyWorkersOfTaskMock(db, bot, task, matchedWorkers),
}));

const {
  sweepPaidWithoutEscrow,
  sweepExpiredClaims,
  sweepUnclaimedNotify,
  sweepPastDeadline,
  sweepUnreleasedSubmissions,
  sweepPendingCallbacks,
  sweepFacilitatorKeepalive,
  failureCount,
} = await import("./index");

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname,
  });
  return db;
}

type DB = Awaited<ReturnType<typeof freshDb>>;
let testDb: DB;

beforeEach(async () => {
  testDb = await freshDb();
  createTaskMock.mockClear().mockResolvedValue({ txHash: "ESCROWTX1" });
  unassignMock.mockClear().mockResolvedValue({ txHash: "UNASSIGNTX1" });
  refundMock.mockClear().mockResolvedValue({ txHash: "REFUNDTX1" });
  releaseMock.mockClear().mockResolvedValue({ txHash: "RELEASETX1" });
  notifyWorkersOfTaskMock.mockClear().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function insertWorker(overrides: Partial<typeof workers.$inferInsert> = {}) {
  const id = ulid();
  const [row] = await testDb
    .insert(workers)
    .values({
      id,
      displayName: "Chidi",
      walletAddress: `C${ulid()}`,
      passkeyCredentialId: ulid(),
      // matchWorkers() (sweepUnclaimedNotify's own real dependency, used
      // from @terreno/shared/routing starting this segment) requires a
      // linked Telegram chat; every pre-existing test in this file inserts
      // workers only for escrow-side jobs that never call matchWorkers, so
      // this default didn't matter before now.
      telegramChatId: `chat-${id}`,
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

function baseTaskFields(overrides: Partial<typeof tasks.$inferInsert> = {}): typeof tasks.$inferInsert {
  const now = Date.now();
  return {
    id: ulid(),
    type: "verify_place",
    status: "paid",
    input: { question: "Is it open?" },
    country: "NG",
    city: "enugu",
    price: 5_000_000,
    fee: 0,
    payerAddress: `G${ulid()}`,
    paymentTxHash: ulid(),
    taskTokenHash: "hash",
    deadlineAt: now + 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function insertTask(overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const [row] = await testDb.insert(tasks).values(baseTaskFields(overrides)).returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function reread(id: string) {
  const [row] = await testDb.select().from(tasks).where(eq(tasks.id, id));
  if (!row) throw new Error("task vanished");
  return row;
}

describe("sweepPaidWithoutEscrow", () => {
  it("retries create_task and moves a paid task to open", async () => {
    const task = await insertTask({ status: "paid" });

    await sweepPaidWithoutEscrow(testDb);

    expect(createTaskMock).toHaveBeenCalledOnce();
    const updated = await reread(task.id);
    expect(updated.status).toBe("open");
    expect(updated.escrowTxHash).toBe("ESCROWTX1");
  });

  it("logs a failed task_events row and leaves the task paid when create_task throws", async () => {
    createTaskMock.mockRejectedValueOnce(new Error("rpc down"));
    const task = await insertTask({ status: "paid" });

    await sweepPaidWithoutEscrow(testDb);

    const updated = await reread(task.id);
    expect(updated.status).toBe("paid");
    expect(await failureCount(testDb, task.id, "create_task")).toBe(1);
  });

  it("stops retrying and logs loudly once the retry limit is reached, without throwing", async () => {
    createTaskMock.mockRejectedValue(new Error("still down"));
    const task = await insertTask({ status: "paid" });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    // 3 real failed ticks to reach the limit.
    await sweepPaidWithoutEscrow(testDb);
    await sweepPaidWithoutEscrow(testDb);
    await sweepPaidWithoutEscrow(testDb);
    createTaskMock.mockClear();

    // A 4th tick must not call create_task again once at the limit.
    await sweepPaidWithoutEscrow(testDb);

    expect(createTaskMock).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("MANUAL refund"));
    const updated = await reread(task.id);
    expect(updated.status).toBe("paid");
    consoleError.mockRestore();
  });

  it("ignores tasks that are not paid", async () => {
    await insertTask({ status: "open" });

    await sweepPaidWithoutEscrow(testDb);

    expect(createTaskMock).not.toHaveBeenCalled();
  });
});

describe("sweepExpiredClaims", () => {
  it("unassigns on-chain and reopens a task whose claim window has passed", async () => {
    const worker = await insertWorker();
    const now = Date.now();
    const task = await insertTask({
      status: "claimed",
      workerId: worker.id,
      claimedAt: now - 20 * 60 * 1000,
      claimExpiresAt: now - 5 * 60 * 1000,
    });

    await sweepExpiredClaims(testDb);

    expect(unassignMock).toHaveBeenCalledOnce();
    const updated = await reread(task.id);
    expect(updated.status).toBe("open");
    expect(updated.workerId).toBeNull();
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimExpiresAt).toBeNull();

    const [event] = await testDb.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    expect(event?.kind).toBe("claim_expired");
  });

  it("leaves a claim alone while its window is still open", async () => {
    const worker = await insertWorker();
    const now = Date.now();
    const task = await insertTask({
      status: "claimed",
      workerId: worker.id,
      claimedAt: now,
      claimExpiresAt: now + 10 * 60 * 1000,
    });

    await sweepExpiredClaims(testDb);

    expect(unassignMock).not.toHaveBeenCalled();
    const updated = await reread(task.id);
    expect(updated.status).toBe("claimed");
  });

  it("logs a failure and does not reopen the task when unassign throws", async () => {
    unassignMock.mockRejectedValueOnce(new Error("rpc down"));
    const worker = await insertWorker();
    const now = Date.now();
    const task = await insertTask({
      status: "claimed",
      workerId: worker.id,
      claimedAt: now - 20 * 60 * 1000,
      claimExpiresAt: now - 5 * 60 * 1000,
    });

    await sweepExpiredClaims(testDb);

    const updated = await reread(task.id);
    expect(updated.status).toBe("claimed");
    expect(await failureCount(testDb, task.id, "unassign")).toBe(1);
  });
});

describe("sweepPastDeadline", () => {
  it("refunds an open task whose deadline has passed", async () => {
    const task = await insertTask({ status: "open", deadlineAt: Date.now() - 1000 });

    await sweepPastDeadline(testDb);

    expect(refundMock).toHaveBeenCalledOnce();
    const updated = await reread(task.id);
    expect(updated.status).toBe("refunded");
    expect(updated.refundTxHash).toBe("REFUNDTX1");
  });

  it("refunds a claimed task whose deadline has passed", async () => {
    const worker = await insertWorker();
    const task = await insertTask({
      status: "claimed",
      workerId: worker.id,
      deadlineAt: Date.now() - 1000,
    });

    await sweepPastDeadline(testDb);

    expect(refundMock).toHaveBeenCalledOnce();
    const updated = await reread(task.id);
    expect(updated.status).toBe("refunded");
  });

  it("leaves a task alone before its deadline", async () => {
    await insertTask({ status: "open", deadlineAt: Date.now() + 60 * 60 * 1000 });

    await sweepPastDeadline(testDb);

    expect(refundMock).not.toHaveBeenCalled();
  });

  it("never refunds a submitted or completed task even past its deadline", async () => {
    await insertTask({ status: "submitted", deadlineAt: Date.now() - 1000 });
    await insertTask({ status: "completed", deadlineAt: Date.now() - 1000 });

    await sweepPastDeadline(testDb);

    expect(refundMock).not.toHaveBeenCalled();
  });
});

describe("sweepUnreleasedSubmissions", () => {
  it("retries release and completes a submitted task", async () => {
    const task = await insertTask({ status: "submitted" });

    await sweepUnreleasedSubmissions(testDb);

    expect(releaseMock).toHaveBeenCalledOnce();
    const updated = await reread(task.id);
    expect(updated.status).toBe("completed");
    expect(updated.releaseTxHash).toBe("RELEASETX1");
  });

  it("logs a failure and keeps retrying indefinitely, with no give-up limit", async () => {
    releaseMock.mockRejectedValue(new Error("rpc down"));
    const task = await insertTask({ status: "submitted" });

    await sweepUnreleasedSubmissions(testDb);
    await sweepUnreleasedSubmissions(testDb);
    await sweepUnreleasedSubmissions(testDb);
    await sweepUnreleasedSubmissions(testDb);

    // Unlike sweepPaidWithoutEscrow, every tick must call release again --
    // there is no retry cap, since a submitted task can only ever end
    // completed (SPEC.md section 9).
    expect(releaseMock).toHaveBeenCalledTimes(4);
    const updated = await reread(task.id);
    expect(updated.status).toBe("submitted");
  });

  it("never touches a task that has not been submitted", async () => {
    await insertTask({ status: "open" });

    await sweepUnreleasedSubmissions(testDb);

    expect(releaseMock).not.toHaveBeenCalled();
  });
});

describe("sweepPendingCallbacks (no-op)", () => {
  it("does nothing and never throws", async () => {
    await expect(sweepPendingCallbacks(testDb)).resolves.toBeUndefined();
  });
});

async function insertFirstWaveNotifiedEvent(taskId: string, workerIds: string[]): Promise<void> {
  await testDb.insert(taskEvents).values({
    id: ulid(),
    taskId,
    kind: "notified",
    data: { workerIds },
    createdAt: Date.now(),
  });
}

describe("sweepUnclaimedNotify", () => {
  const TEN_MINUTES_MS = 10 * 60 * 1000;

  it("skips a task that opened less than 10 minutes ago", async () => {
    await insertWorker();
    const task = await insertTask({ status: "open", createdAt: Date.now() - 1000 });

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).not.toHaveBeenCalled();
    const events = await testDb.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    expect(events).toHaveLength(0);
  });

  it("notifies and records second_wave_notified for an open task past 10 minutes with no prior second wave", async () => {
    const worker = await insertWorker();
    const task = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await insertFirstWaveNotifiedEvent(task.id, []);

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).toHaveBeenCalledTimes(1);
    const [, , notifiedTask, matchedWorkers] = notifyWorkersOfTaskMock.mock.calls[0] ?? [];
    expect(notifiedTask?.id).toBe(task.id);
    expect(matchedWorkers?.map((w) => w.id)).toEqual([worker.id]);

    const events = await testDb
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, task.id), eq(taskEvents.kind, "second_wave_notified")));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ workerIds: [worker.id] });
  });

  it("excludes first-wave-notified workers from the second wave's own matching", async () => {
    const firstWaveWorker = await insertWorker();
    const secondWaveWorker = await insertWorker();
    const task = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await insertFirstWaveNotifiedEvent(task.id, [firstWaveWorker.id]);

    await sweepUnclaimedNotify(testDb);

    const [, , , matchedWorkers] = notifyWorkersOfTaskMock.mock.calls[0] ?? [];
    expect(matchedWorkers?.map((w) => w.id)).toEqual([secondWaveWorker.id]);
  });

  it("does not re-notify a task that already has a second_wave_notified event", async () => {
    const task = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await testDb.insert(taskEvents).values({
      id: ulid(),
      taskId: task.id,
      kind: "second_wave_notified",
      data: { workerIds: [] },
      createdAt: Date.now(),
    });

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).not.toHaveBeenCalled();
  });

  it("still records second_wave_notified (with an empty worker list) when nobody new is eligible", async () => {
    // No workers inserted at all: matchWorkers() legitimately returns [].
    const task = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).toHaveBeenCalledTimes(1);
    const events = await testDb
      .select()
      .from(taskEvents)
      .where(and(eq(taskEvents.taskId, task.id), eq(taskEvents.kind, "second_wave_notified")));
    expect(events).toHaveLength(1);
    expect(events[0]?.data).toEqual({ workerIds: [] });
  });

  it("logs a failure event and keeps processing other tasks when notifyWorkersOfTask throws for one task", async () => {
    const taskA = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    const taskB = await insertTask({ status: "open", createdAt: Date.now() - TEN_MINUTES_MS - 2000 });
    notifyWorkersOfTaskMock.mockRejectedValueOnce(new Error("telegram api down"));

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).toHaveBeenCalledTimes(2);
    const failuresA = await failureCount(testDb, taskA.id, "second_wave_notify");
    const failuresB = await failureCount(testDb, taskB.id, "second_wave_notify");
    // Order isn't guaranteed; exactly one of the two failed and logged.
    expect(failuresA + failuresB).toBe(1);
  });

  it("does not touch a claimed, submitted, completed, or refunded task", async () => {
    await insertTask({ status: "claimed", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await insertTask({ status: "submitted", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await insertTask({ status: "completed", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });
    await insertTask({ status: "refunded", createdAt: Date.now() - TEN_MINUTES_MS - 1000 });

    await sweepUnclaimedNotify(testDb);

    expect(notifyWorkersOfTaskMock).not.toHaveBeenCalled();
  });
});

describe("sweepFacilitatorKeepalive", () => {
  beforeEach(() => {
    vi.stubEnv("FACILITATOR_URL", "https://facilitator.example.test");
  });

  it("pings the facilitator's /health endpoint and does not throw on success", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await sweepFacilitatorKeepalive();

    expect(fetchMock).toHaveBeenCalledWith(
      "https://facilitator.example.test/health",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("logs, but does not throw, when the facilitator responds with a non-2xx status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 503 })),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sweepFacilitatorKeepalive()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("503"));
    consoleError.mockRestore();
  });

  it("logs, but does not throw, when the fetch itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network unreachable");
      }),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(sweepFacilitatorKeepalive()).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalledWith(
      "facilitator keepalive failed:",
      "network unreachable",
    );
    consoleError.mockRestore();
  });
});
