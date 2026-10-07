import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { workers } from "@/lib/db/schema";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname,
  });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";
const CONTRACT_ID = "C" + "A".repeat(55);
const KEY_ID = "YWJjZGVmZ2g";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
});

async function insertWorker(overrides: Partial<typeof workers.$inferInsert> = {}) {
  const [row] = await testDb
    .insert(workers)
    .values({
      id: ulid(),
      displayName: "Chidi",
      walletAddress: CONTRACT_ID,
      passkeyCredentialId: KEY_ID,
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

function signinRequest(body: unknown, options: { origin?: string } = {}): NextRequest {
  return new NextRequest(`${APP_URL}/api/worker/signin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/worker/signin", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("signs in an existing active worker and sets the session cookie", async () => {
    const worker = await insertWorker();

    const res = await POST(signinRequest({ contract_id: CONTRACT_ID, key_id_base64: KEY_ID }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker_id).toBe(worker.id);
    expect(res.headers.get("set-cookie")).toContain("terreno_session=");
  });

  it("signs in a paused worker (pausing is self-initiated, not a lockout)", async () => {
    await insertWorker({ status: "paused" });

    const res = await POST(signinRequest({ contract_id: CONTRACT_ID, key_id_base64: KEY_ID }));

    expect(res.status).toBe(200);
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(signinRequest({ contract_id: CONTRACT_ID, key_id_base64: KEY_ID }, { origin: "" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(signinRequest("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("rejects a body missing required fields", async () => {
    const res = await POST(signinRequest({ contract_id: CONTRACT_ID }));
    expect(res.status).toBe(400);
  });

  it("returns 404 not_found for an unknown contract_id", async () => {
    const res = await POST(signinRequest({ contract_id: CONTRACT_ID, key_id_base64: KEY_ID }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("returns 404 not_found (not a different error) when key_id doesn't match the worker on record", async () => {
    await insertWorker();

    const res = await POST(
      signinRequest({ contract_id: CONTRACT_ID, key_id_base64: "differentKeyId" }),
    );

    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("returns 403 account_banned for a banned worker, without issuing a session", async () => {
    await insertWorker({ status: "banned" });

    const res = await POST(signinRequest({ contract_id: CONTRACT_ID, key_id_base64: KEY_ID }));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("account_banned");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
