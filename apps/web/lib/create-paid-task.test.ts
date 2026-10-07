import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";
import { verifyPlaceSchema, TASK_PRICES_STROOPS } from "@terreno/shared";
import * as schema from "./db/schema";
import { taskEvents, workers } from "./db/schema";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname });
  return db;
}

vi.mock("./db", () => ({
  get db() {
    return testDb;
  },
}));

const settleMock = vi.fn(async () => ({
  success: true,
  payer: "GPAYERADDRESS",
  transaction: "PAYMENTTX1",
}));

vi.mock("./x402", () => ({
  processX402Request: vi.fn(async () => ({
    kind: "payment-verified",
    settle: settleMock,
  })),
  resourceConfigFor: vi.fn(() => ({})),
}));

const escrowCreateTaskMock = vi.fn(async (..._args: unknown[]) => ({ txHash: "ESCROWTX1" }));
vi.mock("./escrow", () => ({
  createTask: (...args: unknown[]) => escrowCreateTaskMock(...args),
  escrowConfigFromEnv: () => ({
    contractId: "C_TEST",
    rpcUrl: "https://example.test",
    networkPassphrase: "Test",
    adminSecretKey: "S_TEST",
    treasurySecretKey: "S_TEST",
  }),
  taskIdToEscrowKey: (taskId: string) => Buffer.from(taskId),
}));

// Typed with real positional params (not `unknown[]`), so a later
// `.mock.calls[0][n]` read gets the actual argument's real type back
// instead of `unknown`.
const matchWorkersMock = vi.fn(async (_db: unknown, _task: typeof schema.tasks.$inferSelect) => []);
vi.mock("./routing", () => ({
  matchWorkers: (db: unknown, task: typeof schema.tasks.$inferSelect) => matchWorkersMock(db, task),
}));

const notifyWorkersOfTaskMock = vi.fn(
  async (_db: unknown, _bot: unknown, _task: typeof schema.tasks.$inferSelect, _workers: unknown[]) =>
    undefined,
);
vi.mock("./telegram", () => ({
  getBot: () => ({ api: {} }),
  notifyWorkersOfTask: (
    db: unknown,
    bot: unknown,
    task: typeof schema.tasks.$inferSelect,
    matchedWorkers: unknown[],
  ) => notifyWorkersOfTaskMock(db, bot, task, matchedWorkers),
}));

const { createPaidTask } = await import("./create-paid-task");

const APP_URL = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("TREASURY_PUBLIC_KEY", "GTREASURY");
  vi.stubEnv("USDC_CONTRACT_ID", "CUSDC");
  settleMock.mockClear();
  settleMock.mockResolvedValue({ success: true, payer: "GPAYERADDRESS", transaction: "PAYMENTTX1" });
  escrowCreateTaskMock.mockClear();
  escrowCreateTaskMock.mockResolvedValue({ txHash: "ESCROWTX1" });
  matchWorkersMock.mockClear();
  matchWorkersMock.mockResolvedValue([]);
  notifyWorkersOfTaskMock.mockClear();
  notifyWorkersOfTaskMock.mockResolvedValue(undefined);
});

async function insertActiveWorker(country: string, city: string): Promise<typeof workers.$inferSelect> {
  const [row] = await testDb
    .insert(workers)
    .values({
      id: ulid(),
      displayName: "Test Worker",
      walletAddress: `C${ulid()}`,
      passkeyCredentialId: ulid(),
      telegramChatId: `chat-${ulid()}`,
      country,
      city,
      languages: ["en"],
      status: "active",
      createdAt: Date.now(),
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

const VALID_BODY = {
  location: { country: "NG", city: "enugu", address: "12 Ogui Road", lat: 6.44, lng: 7.5 },
  place_name: "Mama Nkechi Provisions",
  question: "Is the shop open right now and does it look like an active business?",
  deadline_minutes: 60,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/verify-place", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("createPaidTask: notification wiring after a task opens", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("calls matchWorkers and notifyWorkersOfTask with the newly-opened task, on the real happy path", async () => {
    await insertActiveWorker("NG", "enugu");
    await insertActiveWorker("NG", "enugu");

    const res = await createPaidTask(postRequest(VALID_BODY), {
      type: "verify_place",
      schema: verifyPlaceSchema,
      amountStroops: TASK_PRICES_STROOPS.verify_place,
      routeKey: "verify-place",
      description: "test",
    });

    expect(res.status).toBe(201);
    const body = await res.json();

    expect(matchWorkersMock).toHaveBeenCalledTimes(1);
    const [, matchedTaskArg] = matchWorkersMock.mock.calls[0] ?? [];
    expect(matchedTaskArg?.id).toBe(body.task_id);
    expect(matchedTaskArg?.status).toBe("open");

    expect(notifyWorkersOfTaskMock).toHaveBeenCalledTimes(1);
    const [, , notifiedTaskArg] = notifyWorkersOfTaskMock.mock.calls[0] ?? [];
    expect(notifiedTaskArg?.id).toBe(body.task_id);

    const events = await testDb.select().from(taskEvents).where(eq(taskEvents.taskId, body.task_id));
    // escrowed (paid->open) only; the "notified" event itself is written
    // inside notifyWorkersOfTask, which is mocked here and asserted above
    // via its own dedicated test suite (telegram.test.ts), not re-asserted
    // through this mock.
    expect(events.map((e) => e.kind)).toContain("escrowed");
  });

  it("still returns 201 to the agent when matchWorkers throws (Telegram being down must not fail an already-paid task)", async () => {
    await insertActiveWorker("NG", "enugu");
    await insertActiveWorker("NG", "enugu");
    matchWorkersMock.mockRejectedValueOnce(new Error("db blip"));

    const res = await createPaidTask(postRequest(VALID_BODY), {
      type: "verify_place",
      schema: verifyPlaceSchema,
      amountStroops: TASK_PRICES_STROOPS.verify_place,
      routeKey: "verify-place",
      description: "test",
    });

    expect(res.status).toBe(201);
    expect(notifyWorkersOfTaskMock).not.toHaveBeenCalled();
  });

  it("still returns 201 to the agent when notifyWorkersOfTask itself throws", async () => {
    await insertActiveWorker("NG", "enugu");
    await insertActiveWorker("NG", "enugu");
    notifyWorkersOfTaskMock.mockRejectedValueOnce(new Error("TELEGRAM_BOT_TOKEN is not set"));

    const res = await createPaidTask(postRequest(VALID_BODY), {
      type: "verify_place",
      schema: verifyPlaceSchema,
      amountStroops: TASK_PRICES_STROOPS.verify_place,
      routeKey: "verify-place",
      description: "test",
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task_id).toBeTruthy();
  });
});
