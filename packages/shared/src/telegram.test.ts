import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import * as schema from "./db/schema";
import { notifications, taskEvents, telegramLinks, tasks, workers } from "./db/schema";
import type { TelegramSender } from "./telegram";

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname });
  return db;
}

type DB = Awaited<ReturnType<typeof freshDb>>;

const sendMessageMock = vi.fn(async (..._args: unknown[]) => ({ message_id: 42 }));
const editMessageTextMock = vi.fn(async (..._args: unknown[]) => true);

// notifyWorkersOfTask/markTaskTakenForOthers take `bot` as an explicit
// parameter precisely so a test can hand in this plain mock object instead
// of a real grammY Bot (or a getBot()-intercepting module mock, which
// can't work here: a module mocking itself doesn't rewrite its own
// internal call sites).
// Only message_id (what notifyWorkersOfTask actually reads off the result)
// is faked -- grammY's real sendMessage resolves a full Message object,
// but satisfying every field of that structurally would test nothing this
// code path cares about. The cast says explicitly "this double covers what
// callers in this file use," rather than fighting TypeScript to prove it
// structurally.
const mockBot = {
  api: { sendMessage: sendMessageMock, editMessageText: editMessageTextMock },
} as unknown as TelegramSender;

const { notifyWorkersOfTask, markTaskTakenForOthers, generateLinkCode, consumeLinkCode } = await import(
  "./telegram"
);

const APP_URL = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  sendMessageMock.mockClear();
  editMessageTextMock.mockClear();
  sendMessageMock.mockResolvedValue({ message_id: 42 });
  editMessageTextMock.mockResolvedValue(true);
});

async function insertWorker(
  db: DB,
  overrides: Partial<typeof workers.$inferInsert> = {},
): Promise<typeof workers.$inferSelect> {
  const [row] = await db
    .insert(workers)
    .values({
      id: ulid(),
      displayName: "Test Worker",
      walletAddress: `C${ulid()}`,
      passkeyCredentialId: ulid(),
      telegramChatId: `chat-${ulid()}`,
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
  db: DB,
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<typeof tasks.$inferSelect> {
  const now = Date.now();
  const [row] = await db
    .insert(tasks)
    .values({
      id: ulid(),
      type: "verify_place",
      status: "open",
      input: {},
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

describe("notifyWorkersOfTask", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("sends one Telegram message per matched worker and records a notifications row for each", async () => {
    const task = await insertOpenTask(db);
    const workerA = await insertWorker(db);
    const workerB = await insertWorker(db);

    await notifyWorkersOfTask(db, mockBot, task, [workerA, workerB]);

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.workerId).sort()).toEqual([workerA.id, workerB.id].sort());
    expect(rows.every((r) => r.telegramMessageId === 42)).toBe(true);
  });

  it("logs one notified task_event listing every matched worker id", async () => {
    const task = await insertOpenTask(db);
    const workerA = await insertWorker(db);

    await notifyWorkersOfTask(db, mockBot, task, [workerA]);

    const events = await db.select().from(taskEvents).where(eq(taskEvents.taskId, task.id));
    expect(events).toHaveLength(1);
    expect(events[0]?.kind).toBe("notified");
    expect(events[0]?.data).toEqual({ workerIds: [workerA.id] });
  });

  it("skips a worker with no telegramChatId rather than throwing", async () => {
    const task = await insertOpenTask(db);
    const unlinkedWorker = await insertWorker(db, { telegramChatId: null });

    await notifyWorkersOfTask(db, mockBot, task, [unlinkedWorker]);

    expect(sendMessageMock).not.toHaveBeenCalled();
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    expect(rows).toHaveLength(0);
  });

  it("keeps notifying the rest of the batch when one worker's send fails", async () => {
    const task = await insertOpenTask(db);
    const workerA = await insertWorker(db);
    const workerB = await insertWorker(db);
    sendMessageMock.mockRejectedValueOnce(new Error("blocked by user"));

    await notifyWorkersOfTask(db, mockBot, task, [workerA, workerB]);

    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    const rows = await db.select().from(notifications).where(eq(notifications.taskId, task.id));
    // Only the worker whose send succeeded gets a notifications row.
    expect(rows).toHaveLength(1);
    expect(rows[0]?.workerId).toBe(workerB.id);
  });
});

describe("markTaskTakenForOthers", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("edits every other recipient's message, not the winner's own", async () => {
    const task = await insertOpenTask(db);
    const winner = await insertWorker(db);
    const loserA = await insertWorker(db);
    const loserB = await insertWorker(db);
    await notifyWorkersOfTask(db, mockBot, task, [winner, loserA, loserB]);
    editMessageTextMock.mockClear();

    await markTaskTakenForOthers(db, mockBot, task.id, winner.id);

    expect(editMessageTextMock).toHaveBeenCalledTimes(2);
    const editedChatIds = editMessageTextMock.mock.calls.map((call) => call[0]);
    expect(editedChatIds).toContain(loserA.telegramChatId);
    expect(editedChatIds).toContain(loserB.telegramChatId);
    expect(editedChatIds).not.toContain(winner.telegramChatId);
  });

  it("keeps editing the rest when one message edit fails", async () => {
    const task = await insertOpenTask(db);
    const winner = await insertWorker(db);
    const loserA = await insertWorker(db);
    const loserB = await insertWorker(db);
    await notifyWorkersOfTask(db, mockBot, task, [winner, loserA, loserB]);
    editMessageTextMock.mockClear();
    editMessageTextMock.mockRejectedValueOnce(new Error("message too old to edit"));

    await expect(markTaskTakenForOthers(db, mockBot, task.id, winner.id)).resolves.toBeUndefined();

    expect(editMessageTextMock).toHaveBeenCalledTimes(2);
  });
});

describe("generateLinkCode + consumeLinkCode", () => {
  let db: DB;

  beforeEach(async () => {
    db = await freshDb();
  });

  it("links a worker to a chat id on a valid, unexpired code", async () => {
    const worker = await insertWorker(db, { telegramChatId: null });
    const code = await generateLinkCode(db, worker.id);

    const result = await consumeLinkCode(db, code, "new-chat-id");

    expect(result).toEqual({ kind: "linked", workerId: worker.id });
    const [reloaded] = await db.select().from(workers).where(eq(workers.id, worker.id));
    expect(reloaded?.telegramChatId).toBe("new-chat-id");
  });

  it("deletes the code on consumption, so a second /start with the same code fails", async () => {
    const worker = await insertWorker(db, { telegramChatId: null });
    const code = await generateLinkCode(db, worker.id);

    const first = await consumeLinkCode(db, code, "chat-1");
    const second = await consumeLinkCode(db, code, "chat-2");

    expect(first.kind).toBe("linked");
    expect(second).toEqual({ kind: "invalid_or_expired" });
    const rows = await db.select().from(telegramLinks).where(eq(telegramLinks.code, code));
    expect(rows).toHaveLength(0);
  });

  it("rejects a code that was never generated", async () => {
    const result = await consumeLinkCode(db, "bogus-code", "chat-1");

    expect(result).toEqual({ kind: "invalid_or_expired" });
  });

  it("rejects an expired code without linking, and still consumes it", async () => {
    const worker = await insertWorker(db, { telegramChatId: null });
    const code = ulid();
    await db.insert(telegramLinks).values({ code, workerId: worker.id, expiresAt: Date.now() - 1000 });

    const result = await consumeLinkCode(db, code, "chat-1");

    expect(result).toEqual({ kind: "invalid_or_expired" });
    const [reloaded] = await db.select().from(workers).where(eq(workers.id, worker.id));
    expect(reloaded?.telegramChatId).toBeNull();
  });

  it("refuses to re-link a chat id already linked to a different worker", async () => {
    const existingWorker = await insertWorker(db, { telegramChatId: "shared-chat-id" });
    const newWorker = await insertWorker(db, { telegramChatId: null });
    const code = await generateLinkCode(db, newWorker.id);

    const result = await consumeLinkCode(db, code, "shared-chat-id");

    expect(result).toEqual({ kind: "already_linked_elsewhere" });
    const [reloadedExisting] = await db.select().from(workers).where(eq(workers.id, existingWorker.id));
    expect(reloadedExisting?.telegramChatId).toBe("shared-chat-id");
    const [reloadedNew] = await db.select().from(workers).where(eq(workers.id, newWorker.id));
    expect(reloadedNew?.telegramChatId).toBeNull();
  });

  it("allows the same worker to re-run /start with their own already-linked chat id", async () => {
    const worker = await insertWorker(db, { telegramChatId: "my-chat-id" });
    const code = await generateLinkCode(db, worker.id);

    const result = await consumeLinkCode(db, code, "my-chat-id");

    expect(result).toEqual({ kind: "linked", workerId: worker.id });
  });
});
