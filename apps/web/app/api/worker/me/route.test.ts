import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { ratings, tasks, workers } from "@/lib/db/schema";
import { signSession } from "@/lib/session";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../../../../lib/db/migrations", import.meta.url).pathname,
  });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const getUsdcBalanceMock = vi.fn(async (..._args: unknown[]) => 0n);
vi.mock("@/lib/usdc", () => ({
  getUsdcBalance: (...args: unknown[]) => getUsdcBalanceMock(...args),
}));

const { GET } = await import("./route");

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
  getUsdcBalanceMock.mockReset();
  getUsdcBalanceMock.mockResolvedValue(0n);
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

async function insertCompletedTask(workerId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const now = Date.now();
  const [row] = await testDb
    .insert(tasks)
    .values({
      id: ulid(),
      type: "verify_place",
      status: "completed",
      input: {},
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 500_000,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      taskTokenHash: "hash",
      workerId,
      releaseTxHash: "RELEASETX1",
      deadlineAt: now + 1000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

function meRequest(token?: string): NextRequest {
  return new NextRequest("http://localhost:3000/api/worker/me", {
    headers: token ? { cookie: `terreno_session=${token}` } : {},
  });
}

describe("GET /api/worker/me", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects a request with no session cookie", async () => {
    const res = await GET(meRequest());
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("not_signed_in");
  });

  it("rejects a session for a worker id that no longer exists", async () => {
    const token = await signSession({ workerId: ulid() });
    const res = await GET(meRequest(token));
    expect(res.status).toBe(401);
  });

  it("returns profile, score, balance and empty earnings for a brand-new worker", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });
    getUsdcBalanceMock.mockResolvedValue(12_340_000n); // 1.234 USDC

    const res = await GET(meRequest(token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe("Chidi");
    expect(body.country).toBe("NG");
    expect(body.completed_tasks).toBe(0);
    expect(body.score).toBeCloseTo(0.5 * (5 / 6), 10);
    expect(body.balance.usdc).toBeCloseTo(1.234, 10);
    expect(body.balance.approx_local.currency).toBe("NGN");
    expect(body.earnings).toEqual([]);
    expect(body.cash_out.available).toBe(false);
  });

  it("includes completed tasks in earnings with a tx link and net-of-fee amount", async () => {
    const worker = await insertWorker();
    await insertCompletedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await GET(meRequest(token));
    const body = await res.json();

    expect(body.completed_tasks).toBe(1);
    expect(body.earnings).toHaveLength(1);
    expect(body.earnings[0].paid_usdc).toBeCloseTo(0.45, 10); // (5_000_000 - 500_000) / 1e7
    expect(body.earnings[0].release_tx).toContain("RELEASETX1");
  });

  it("excludes a claimed-but-not-yet-completed task from earnings", async () => {
    const worker = await insertWorker();
    const now = Date.now();
    await testDb.insert(tasks).values({
      id: ulid(),
      type: "verify_place",
      status: "claimed",
      input: {},
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 500_000,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      taskTokenHash: "hash",
      workerId: worker.id,
      claimedAt: now,
      claimExpiresAt: now + 1000,
      deadlineAt: now + 1000,
      createdAt: now,
      updatedAt: now,
    });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(meRequest(token));
    const body = await res.json();

    expect(body.earnings).toEqual([]);
  });

  it("averages this worker's real ratings into the score", async () => {
    const worker = await insertWorker();
    const task = await insertCompletedTask(worker.id);
    await testDb.insert(ratings).values({ id: ulid(), taskId: task.id, score: 5, createdAt: Date.now() });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(meRequest(token));
    const body = await res.json();

    // reliability = (1+1)/(1+0+2) = 2/3; quality = (5+1)/6 = 1
    expect(body.score).toBeCloseTo(2 / 3, 10);
  });

  it("returns balance.usdc null without failing the whole request when the chain read fails", async () => {
    const worker = await insertWorker();
    getUsdcBalanceMock.mockRejectedValue(new Error("rpc timeout"));
    const token = await signSession({ workerId: worker.id });

    const res = await GET(meRequest(token));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.balance.usdc).toBeNull();
    expect(body.balance.error).toBe("unavailable");
  });

  it("orders earnings by most recently completed first", async () => {
    const worker = await insertWorker();
    const first = await insertCompletedTask(worker.id, { updatedAt: 1000 });
    const second = await insertCompletedTask(worker.id, { updatedAt: 2000 });
    const token = await signSession({ workerId: worker.id });

    const res = await GET(meRequest(token));
    const body = await res.json();

    expect(body.earnings[0].task_id).toBe(second.id);
    expect(body.earnings[1].task_id).toBe(first.id);
  });
});
