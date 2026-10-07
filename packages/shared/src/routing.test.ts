import { beforeEach, describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "./db/schema";
import { notifications, tasks, workers } from "./db/schema";
import { matchWorkers } from "./routing";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname });
  return db;
}

type DB = Awaited<ReturnType<typeof freshDb>>;

interface WorkerOverrides {
  country?: string;
  city?: string;
  status?: "active" | "paused" | "banned";
  telegramChatId?: string | null;
  languages?: string[];
}

async function insertWorker(db: DB, overrides: WorkerOverrides = {}): Promise<string> {
  const id = ulid();
  // "telegramChatId" in overrides, not `?? `: a caller passing { telegramChatId:
  // null } explicitly wants null persisted (the "no linked Telegram" case), but
  // `??` treats null and "key absent" identically and would silently replace it
  // with the auto-generated fallback, defeating the one test that needs real null.
  const telegramChatId = "telegramChatId" in overrides ? overrides.telegramChatId : `chat-${id}`;
  await db.insert(workers).values({
    id,
    displayName: "Test Worker",
    walletAddress: `C${ulid()}`,
    passkeyCredentialId: ulid(),
    telegramChatId,
    country: overrides.country ?? "NG",
    city: overrides.city ?? "enugu",
    languages: overrides.languages ?? ["en"],
    status: overrides.status ?? "active",
    createdAt: Date.now(),
  });
  return id;
}

interface TaskOverrides {
  type?: "verify_place" | "check_price" | "translate";
  country?: string;
  city?: string;
  input?: unknown;
  workerId?: string;
  status?: "paid" | "open" | "claimed" | "submitted" | "completed" | "refunded";
}

async function insertTask(db: DB, overrides: TaskOverrides = {}) {
  const now = Date.now();
  const id = ulid();
  const [task] = await db
    .insert(tasks)
    .values({
      id,
      type: overrides.type ?? "verify_place",
      status: overrides.status ?? "open",
      input: overrides.input ?? {},
      country: overrides.country ?? "NG",
      city: overrides.city ?? "enugu",
      price: 1,
      fee: 0,
      payerAddress: "GPAYER",
      paymentTxHash: id,
      taskTokenHash: "hash",
      workerId: overrides.workerId,
      claimedAt: overrides.workerId ? now : undefined,
      claimExpiresAt: overrides.workerId ? now + 15 * 60 * 1000 : undefined,
      deadlineAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  if (!task) {
    throw new Error("insertTask: insert returned no row");
  }
  return task;
}

async function insertNotification(db: DB, taskId: string, workerId: string, createdAt: number): Promise<void> {
  await db.insert(notifications).values({
    id: ulid(),
    taskId,
    workerId,
    telegramChatId: `chat-${workerId}`,
    telegramMessageId: 1,
    createdAt,
  });
}

describe("matchWorkers", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("matches an active, telegram-linked worker in the task's own city", async () => {
    const workerId = await insertWorker(db);
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched.map((w) => w.id)).toEqual([workerId]);
  });

  it("excludes workers in a different city or country", async () => {
    await insertWorker(db, { city: "lagos" });
    await insertWorker(db, { country: "CL", city: "enugu" });
    const task = await insertTask(db, { country: "NG", city: "enugu" });

    const matched = await matchWorkers(db, task);

    expect(matched).toEqual([]);
  });

  it("excludes paused and banned workers", async () => {
    await insertWorker(db, { status: "paused" });
    await insertWorker(db, { status: "banned" });
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched).toEqual([]);
  });

  it("excludes a worker with no linked Telegram chat", async () => {
    await insertWorker(db, { telegramChatId: null });
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched).toEqual([]);
  });

  it("excludes a worker who is currently holding a claim on another task", async () => {
    const busyWorkerId = await insertWorker(db);
    await insertTask(db, { status: "claimed", workerId: busyWorkerId });
    const openTask = await insertTask(db);

    const matched = await matchWorkers(db, openTask);

    expect(matched).toEqual([]);
  });

  it("does not exclude a worker whose own claim already expired back to open", async () => {
    // Regression guard: a worker with a past claimed task that has since
    // reopened (claimed -> open nulls tasks.worker_id, per transition.ts)
    // must not be treated as still busy just because they once held a
    // claim on a different task row.
    const workerId = await insertWorker(db);
    const expiredClaimTask = await insertTask(db);
    await db.update(tasks).set({ status: "open", workerId: null }).where(eq(tasks.id, expiredClaimTask.id));
    const newTask = await insertTask(db);

    const matched = await matchWorkers(db, newTask);

    expect(matched.map((w) => w.id)).toEqual([workerId]);
  });

  it("requires language match for translate tasks, and ignores language for other types", async () => {
    const igSpeaker = await insertWorker(db, { languages: ["en", "ig"] });
    await insertWorker(db, { languages: ["en"] }); // no "ig"
    const translateTask = await insertTask(db, {
      type: "translate",
      input: { location: { country: "NG", city: "enugu" }, source_text: "hi", target_language: "ig", deadline_minutes: 30 },
    });

    const matched = await matchWorkers(db, translateTask);

    expect(matched.map((w) => w.id)).toEqual([igSpeaker]);
  });

  it("ranks higher-reputation workers first", async () => {
    const lowRepWorker = await insertWorker(db);
    const highRepWorker = await insertWorker(db);
    // Give highRepWorker 3 completed tasks (raises reliability); lowRepWorker has 0.
    for (let i = 0; i < 3; i++) {
      await insertTask(db, { status: "completed", workerId: highRepWorker });
    }
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched.map((w) => w.id)).toEqual([highRepWorker, lowRepWorker]);
  });

  it("breaks a reputation tie by least-recently-notified, nulls (never notified) first", async () => {
    const neverNotified = await insertWorker(db);
    const notifiedLongAgo = await insertWorker(db);
    const notifiedRecently = await insertWorker(db);
    const task = await insertTask(db);
    await insertNotification(db, task.id, notifiedRecently, Date.now());
    await insertNotification(db, task.id, notifiedLongAgo, Date.now() - 1_000_000);

    const matched = await matchWorkers(db, task);

    expect(matched.map((w) => w.id)).toEqual([neverNotified, notifiedLongAgo, notifiedRecently]);
  });

  it("caps at 10 even when more workers are eligible", async () => {
    for (let i = 0; i < 15; i++) {
      await insertWorker(db);
    }
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched).toHaveLength(10);
  });

  it("excludeWorkerIds removes the first wave so the sweeper's second wave gets only new workers", async () => {
    const firstWaveWorker = await insertWorker(db);
    const secondWaveWorker = await insertWorker(db);
    const task = await insertTask(db);

    const secondWave = await matchWorkers(db, task, { excludeWorkerIds: [firstWaveWorker] });

    expect(secondWave.map((w) => w.id)).toEqual([secondWaveWorker]);
  });

  it("returns an empty array, not an error, when nobody is eligible", async () => {
    const task = await insertTask(db);

    const matched = await matchWorkers(db, task);

    expect(matched).toEqual([]);
  });
});
