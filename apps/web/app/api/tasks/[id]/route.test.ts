import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks } from "@/lib/db/schema";
import { hashTaskToken } from "@/lib/task-token";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, { migrationsFolder: new URL("../../../../lib/db/migrations", import.meta.url).pathname });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { GET } = await import("./route");

function baseTaskFields(overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const now = Date.now();
  return {
    id: ulid(),
    type: "verify_place" as const,
    status: "open" as const,
    input: { question: "Is it open?" },
    country: "NG",
    city: "enugu",
    price: 5_000_000,
    fee: 500_000,
    payerAddress: "GPAYERADDRESS",
    paymentTxHash: ulid(),
    escrowTxHash: "ESCROWTX1",
    taskTokenHash: hashTaskToken("tr_tok_test"),
    deadlineAt: now + 60 * 60 * 1000,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function getRequest(id: string, token?: string): NextRequest {
  return new NextRequest(`http://localhost/api/tasks/${id}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("GET /api/tasks/[id]", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("returns the task for a valid token", async () => {
    const task = baseTaskFields();
    await testDb.insert(tasks).values(task);

    const res = await GET(getRequest(task.id, "tr_tok_test"), {
      params: Promise.resolve({ id: task.id }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task_id).toBe(task.id);
    expect(body.type).toBe("verify_place");
    expect(body.status).toBe("open");
    expect(body.transactions.payment).toBe(task.paymentTxHash);
    expect(body.transactions.escrow).toBe(task.escrowTxHash);
    expect(body.transactions.release).toBeUndefined();
    expect(body.transactions.refund).toBeUndefined();
  });

  it("rejects a missing Authorization header", async () => {
    const task = baseTaskFields();
    await testDb.insert(tasks).values(task);

    const res = await GET(getRequest(task.id), { params: Promise.resolve({ id: task.id }) });

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_token");
  });

  it("rejects a non-Bearer Authorization header", async () => {
    const task = baseTaskFields();
    await testDb.insert(tasks).values(task);

    const res = await GET(
      new NextRequest(`http://localhost/api/tasks/${task.id}`, {
        headers: { authorization: "Basic abc123" },
      }),
      { params: Promise.resolve({ id: task.id }) },
    );

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_token");
  });

  it("rejects the wrong token for an existing task", async () => {
    const task = baseTaskFields();
    await testDb.insert(tasks).values(task);

    const res = await GET(getRequest(task.id, "tr_tok_wrong"), {
      params: Promise.resolve({ id: task.id }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_token");
  });

  it("returns bad_token (not a different error) for a nonexistent task id", async () => {
    const res = await GET(getRequest("does-not-exist", "tr_tok_test"), {
      params: Promise.resolve({ id: "does-not-exist" }),
    });

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_token");
  });

  it("includes refund in transactions for a refunded task", async () => {
    const task = baseTaskFields({ status: "refunded", refundTxHash: "REFUNDTX1" });
    await testDb.insert(tasks).values(task);

    const res = await GET(getRequest(task.id, "tr_tok_test"), {
      params: Promise.resolve({ id: task.id }),
    });

    const body = await res.json();
    expect(body.transactions.refund).toBe("REFUNDTX1");
  });

  it("rate-limits a second poll within 10 seconds", async () => {
    const task = baseTaskFields();
    await testDb.insert(tasks).values(task);

    const first = await GET(getRequest(task.id, "tr_tok_test"), {
      params: Promise.resolve({ id: task.id }),
    });
    expect(first.status).toBe(200);

    const second = await GET(getRequest(task.id, "tr_tok_test"), {
      params: Promise.resolve({ id: task.id }),
    });
    expect(second.status).toBe(429);
    expect((await second.json()).error).toBe("rate_limited");
  });
});
