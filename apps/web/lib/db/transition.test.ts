import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "./schema.js";
import { tasks, taskEvents, workers } from "./schema.js";
import { eq } from "drizzle-orm";
import { transition, TransitionError, type Task, type TaskStatus } from "./transition.js";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.url).pathname });
  return db;
}

type DB = Awaited<ReturnType<typeof freshDb>>;

function baseTaskFields(overrides: Partial<Task> = {}): typeof tasks.$inferInsert {
  const now = Date.now();
  return {
    id: ulid(),
    type: "verify_place",
    status: "paid",
    input: { question: "Is it open?" },
    country: "NG",
    city: "enugu",
    price: 5_000_000,
    fee: 500_000,
    payerAddress: "GPAYERADDRESSEXAMPLE",
    paymentTxHash: ulid(),
    taskTokenHash: "hash",
    deadlineAt: now + 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

async function insertTask(db: DB, overrides: Partial<Task> = {}): Promise<Task> {
  const [row] = await db
    .insert(tasks)
    .values(baseTaskFields(overrides))
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

async function insertWorker(db: DB): Promise<string> {
  const id = ulid();
  await db.insert(workers).values({
    id,
    displayName: "Test Worker",
    walletAddress: `C${ulid()}`,
    passkeyCredentialId: ulid(),
    country: "NG",
    city: "enugu",
    languages: ["en"],
    status: "active",
    createdAt: Date.now(),
  });
  return id;
}

async function eventsFor(db: DB, taskId: string) {
  return db.select().from(taskEvents).where(eq(taskEvents.taskId, taskId));
}

describe("transition", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  // ---- allowed transitions ----

  it("paid -> open writes escrow_tx_hash and an escrowed event", async () => {
    const task = await insertTask(db, { status: "paid" });

    const updated = await transition(db, task, "open", { escrowTxHash: "ESCROWTX1" });

    expect(updated.status).toBe("open");
    expect(updated.escrowTxHash).toBe("ESCROWTX1");
    const events = await eventsFor(db, task.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("escrowed");
  });

  it("paid -> refunded writes refund_tx_hash and a refunded event", async () => {
    const task = await insertTask(db, { status: "paid" });

    const updated = await transition(db, task, "refunded", { refundTxHash: "REFUNDTX1" });

    expect(updated.status).toBe("refunded");
    expect(updated.refundTxHash).toBe("REFUNDTX1");
    const events = await eventsFor(db, task.id);
    expect(events[0]?.kind).toBe("refunded");
  });

  it("open -> claimed sets worker_id, claimed_at, claim_expires_at and a claimed event", async () => {
    const task = await insertTask(db, { status: "open" });
    const workerId = await insertWorker(db);
    const claimedAt = Date.now();

    const updated = await transition(db, task, "claimed", {
      workerId,
      claimedAt,
    });

    expect(updated.status).toBe("claimed");
    expect(updated.workerId).toBe(workerId);
    expect(updated.claimedAt).toBe(claimedAt);
    expect(updated.claimExpiresAt).toBe(claimedAt + 15 * 60 * 1000);
    const events = await eventsFor(db, task.id);
    expect(events[0]?.kind).toBe("claimed");
  });

  it("open -> refunded writes refund_tx_hash and a refunded event", async () => {
    const task = await insertTask(db, { status: "open" });

    const updated = await transition(db, task, "refunded", { refundTxHash: "REFUNDTX2" });

    expect(updated.status).toBe("refunded");
    expect(updated.refundTxHash).toBe("REFUNDTX2");
  });

  it("claimed -> open clears worker_id, claimed_at, claim_expires_at and a claim_expired event", async () => {
    const task = await insertTask(db, {
      status: "claimed",
      workerId: null,
      claimedAt: Date.now(),
      claimExpiresAt: Date.now() + 1000,
    });

    const updated = await transition(db, task, "open", {});

    expect(updated.status).toBe("open");
    expect(updated.workerId).toBeNull();
    expect(updated.claimedAt).toBeNull();
    expect(updated.claimExpiresAt).toBeNull();
    const events = await eventsFor(db, task.id);
    expect(events[0]?.kind).toBe("claim_expired");
  });

  it("claimed -> submitted sets submitted_at and a submitted event", async () => {
    const task = await insertTask(db, { status: "claimed" });
    const submittedAt = Date.now();

    const updated = await transition(db, task, "submitted", { submittedAt });

    expect(updated.status).toBe("submitted");
    expect(updated.submittedAt).toBe(submittedAt);
    const events = await eventsFor(db, task.id);
    expect(events[0]?.kind).toBe("submitted");
  });

  it("claimed -> refunded writes refund_tx_hash and a refunded event", async () => {
    const task = await insertTask(db, { status: "claimed" });

    const updated = await transition(db, task, "refunded", { refundTxHash: "REFUNDTX3" });

    expect(updated.status).toBe("refunded");
    expect(updated.refundTxHash).toBe("REFUNDTX3");
  });

  it("submitted -> completed writes release_tx_hash and a released event", async () => {
    const task = await insertTask(db, { status: "submitted" });

    const updated = await transition(db, task, "completed", { releaseTxHash: "RELEASETX1" });

    expect(updated.status).toBe("completed");
    expect(updated.releaseTxHash).toBe("RELEASETX1");
    const events = await eventsFor(db, task.id);
    expect(events[0]?.kind).toBe("released");
  });

  // ---- forbidden transitions: every other (from, to) pair must throw ----

  const ALL_STATUSES: TaskStatus[] = [
    "paid",
    "open",
    "claimed",
    "submitted",
    "completed",
    "refunded",
  ];

  const ALLOWED: Array<[TaskStatus, TaskStatus]> = [
    ["paid", "open"],
    ["paid", "refunded"],
    ["open", "claimed"],
    ["open", "refunded"],
    ["claimed", "open"],
    ["claimed", "submitted"],
    ["claimed", "refunded"],
    ["submitted", "completed"],
  ];

  function isAllowed(from: TaskStatus, to: TaskStatus): boolean {
    return ALLOWED.some(([f, t]) => f === from && t === to);
  }

  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      if (from === to || isAllowed(from, to)) continue;

      it(`${from} -> ${to} is forbidden and throws TransitionError`, async () => {
        const task = await insertTask(db, { status: from });

        await expect(transition(db, task, to, {})).rejects.toThrow(TransitionError);

        // Verify nothing was written: status unchanged, no event row.
        const [reloaded] = await db.select().from(tasks).where(eq(tasks.id, task.id));
        expect(reloaded?.status).toBe(from);
        const events = await eventsFor(db, task.id);
        expect(events).toHaveLength(0);
      });
    }
  }

  it("same-status transitions are also forbidden (e.g. open -> open)", async () => {
    const task = await insertTask(db, { status: "open" });

    await expect(transition(db, task, "open", {})).rejects.toThrow(TransitionError);
  });

  it("completed and refunded are terminal: no transition out is allowed", async () => {
    const completed = await insertTask(db, { status: "completed" });
    const refunded = await insertTask(db, { status: "refunded" });

    for (const to of ALL_STATUSES) {
      await expect(transition(db, completed, to, {})).rejects.toThrow(TransitionError);
      await expect(transition(db, refunded, to, {})).rejects.toThrow(TransitionError);
    }
  });

  // ---- missing required context data ----

  it("paid -> open without escrowTxHash throws", async () => {
    const task = await insertTask(db, { status: "paid" });

    await expect(transition(db, task, "open", {})).rejects.toThrow(
      /missing required string field "escrowTxHash"/,
    );
  });

  it("open -> claimed without claimedAt throws", async () => {
    const task = await insertTask(db, { status: "open" });

    await expect(transition(db, task, "claimed", { workerId: "worker-1" })).rejects.toThrow(
      /missing required number field "claimedAt"/,
    );
  });
});
