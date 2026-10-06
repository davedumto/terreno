import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "./db/schema";
import { ratings, taskEvents, tasks, workers } from "./db/schema";
import { computeReputationScore } from "./reputation";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("./db/migrations", import.meta.url).pathname });
  return db;
}

type DB = Awaited<ReturnType<typeof freshDb>>;

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

async function insertCompletedTask(db: DB, workerId: string, ratingScore?: number): Promise<string> {
  const now = Date.now();
  const taskId = ulid();
  await db.insert(tasks).values({
    id: taskId,
    type: "verify_place",
    status: "completed",
    input: {},
    country: "NG",
    city: "enugu",
    price: 1,
    fee: 0,
    payerAddress: "GPAYER",
    paymentTxHash: taskId,
    taskTokenHash: "hash",
    workerId,
    deadlineAt: now + 1000,
    createdAt: now,
    updatedAt: now,
  });
  if (ratingScore !== undefined) {
    await db.insert(ratings).values({
      id: ulid(),
      taskId,
      score: ratingScore,
      createdAt: now,
    });
  }
  return taskId;
}

async function insertExpiredClaimEvent(db: DB, workerId: string): Promise<void> {
  const now = Date.now();
  const taskId = ulid();
  await db.insert(tasks).values({
    id: taskId,
    type: "verify_place",
    status: "open",
    input: {},
    country: "NG",
    city: "enugu",
    price: 1,
    fee: 0,
    payerAddress: "GPAYER",
    paymentTxHash: taskId,
    taskTokenHash: "hash",
    deadlineAt: now + 1000,
    createdAt: now,
    updatedAt: now,
  });
  await db.insert(taskEvents).values({
    id: ulid(),
    taskId,
    kind: "claim_expired",
    data: { expiredWorkerId: workerId },
    createdAt: now,
  });
}

describe("computeReputationScore", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("gives a brand-new worker (0 completed, 0 expired, no ratings) a neutral score", async () => {
    const workerId = await insertWorker(db);

    const result = await computeReputationScore(db, workerId);

    // reliability = (0+1)/(0+0+2) = 0.5; quality = (4+1)/6 = 0.8333...
    expect(result.completedTasks).toBe(0);
    expect(result.expiredClaims).toBe(0);
    expect(result.avgRating).toBe(4);
    expect(result.score).toBeCloseTo(0.5 * (5 / 6), 10);
  });

  it("raises the score as completed tasks increase", async () => {
    const workerId = await insertWorker(db);
    await insertCompletedTask(db, workerId);
    await insertCompletedTask(db, workerId);
    await insertCompletedTask(db, workerId);

    const result = await computeReputationScore(db, workerId);

    expect(result.completedTasks).toBe(3);
    // reliability = (3+1)/(3+0+2) = 0.8; quality defaults to 5/6 (no ratings)
    expect(result.score).toBeCloseTo(0.8 * (5 / 6), 10);
  });

  it("lowers the score as expired claims increase", async () => {
    const workerId = await insertWorker(db);
    await insertCompletedTask(db, workerId);
    await insertExpiredClaimEvent(db, workerId);
    await insertExpiredClaimEvent(db, workerId);

    const result = await computeReputationScore(db, workerId);

    expect(result.completedTasks).toBe(1);
    expect(result.expiredClaims).toBe(2);
    // reliability = (1+1)/(1+2+2) = 0.4
    expect(result.score).toBeCloseTo(0.4 * (5 / 6), 10);
  });

  it("averages this worker's ratings only, ignoring other workers' ratings", async () => {
    const workerId = await insertWorker(db);
    const otherWorkerId = await insertWorker(db);
    await insertCompletedTask(db, workerId, 5);
    await insertCompletedTask(db, workerId, 3);
    await insertCompletedTask(db, otherWorkerId, 1); // must not affect workerId's average

    const result = await computeReputationScore(db, workerId);

    expect(result.avgRating).toBeCloseTo(4, 10); // (5+3)/2
  });

  it("defaults avgRating to 4 when the worker has completed tasks but no ratings at all", async () => {
    const workerId = await insertWorker(db);
    await insertCompletedTask(db, workerId); // no rating given

    const result = await computeReputationScore(db, workerId);

    expect(result.avgRating).toBe(4);
  });

  it("does not count another worker's expired claims", async () => {
    const workerId = await insertWorker(db);
    const otherWorkerId = await insertWorker(db);
    await insertExpiredClaimEvent(db, otherWorkerId);

    const result = await computeReputationScore(db, workerId);

    expect(result.expiredClaims).toBe(0);
  });

  it("does not count a non-completed task toward completedTasks even if worker_id is set", async () => {
    const workerId = await insertWorker(db);
    const now = Date.now();
    await db.insert(tasks).values({
      id: ulid(),
      type: "verify_place",
      status: "claimed",
      input: {},
      country: "NG",
      city: "enugu",
      price: 1,
      fee: 0,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      taskTokenHash: "hash",
      workerId,
      claimedAt: now,
      claimExpiresAt: now + 1000,
      deadlineAt: now + 1000,
      createdAt: now,
      updatedAt: now,
    });

    const result = await computeReputationScore(db, workerId);

    expect(result.completedTasks).toBe(0);
  });

  it("stays within [0, 1] at the extremes (many completed, zero expired, top ratings)", async () => {
    const workerId = await insertWorker(db);
    for (let i = 0; i < 20; i++) {
      await insertCompletedTask(db, workerId, 5);
    }

    const result = await computeReputationScore(db, workerId);

    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });
});
