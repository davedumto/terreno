import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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
});

afterEach(() => {
  vi.unstubAllGlobals();
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

describe("sweepUnclaimedNotify and sweepPendingCallbacks (no-ops)", () => {
  it("do nothing and never throw", async () => {
    await expect(sweepUnclaimedNotify(testDb)).resolves.toBeUndefined();
    await expect(sweepPendingCallbacks(testDb)).resolves.toBeUndefined();
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
