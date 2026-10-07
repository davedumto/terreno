import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
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

const verifyWorkerWalletMock = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("@/lib/worker-wallet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/worker-wallet")>("@/lib/worker-wallet");
  return {
    ...actual,
    verifyWorkerWallet: (...args: unknown[]) => verifyWorkerWalletMock(...args),
  };
});

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";
const CONTRACT_ID = "C" + "A".repeat(55);
const VALID_BODY = {
  contract_id: CONTRACT_ID,
  display_name: "Chidi",
  country: "NG",
  city: "enugu",
  languages: ["en", "ig"],
  key_id_base64: "YWJjZGVmZ2g",
};

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
  verifyWorkerWalletMock.mockReset();
  verifyWorkerWalletMock.mockResolvedValue(undefined);
});

function confirmRequest(body: unknown, options: { origin?: string } = {}): NextRequest {
  return new NextRequest(`${APP_URL}/api/worker/confirm`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/worker/confirm", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("creates a worker row, signs a session, and sets the cookie", async () => {
    const res = await POST(confirmRequest(VALID_BODY));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.worker_id).toBeTruthy();
    expect(res.headers.get("set-cookie")).toContain("terreno_session=");

    const [worker] = await testDb.select().from(workers).where(eq(workers.id, body.worker_id));
    expect(worker?.displayName).toBe("Chidi");
    expect(worker?.walletAddress).toBe(CONTRACT_ID);
    expect(worker?.status).toBe("active");
    expect(verifyWorkerWalletMock).toHaveBeenCalledWith(CONTRACT_ID);
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(confirmRequest(VALID_BODY, { origin: "" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
    expect(verifyWorkerWalletMock).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(confirmRequest("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("rejects a body missing required fields", async () => {
    const res = await POST(confirmRequest({ contract_id: CONTRACT_ID }));
    expect(res.status).toBe(400);
  });

  it("returns 403 wallet_verification_failed, does not write a workers row, when verification fails", async () => {
    const { WalletVerificationError } = await import("@/lib/worker-wallet");
    verifyWorkerWalletMock.mockRejectedValue(
      new WalletVerificationError("wasm hash mismatch"),
    );

    const res = await POST(confirmRequest(VALID_BODY));

    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("wallet_verification_failed");
    const rows = await testDb.select().from(workers);
    expect(rows).toHaveLength(0);
  });

  it("rethrows an unexpected verification error rather than reporting it as a verification failure", async () => {
    verifyWorkerWalletMock.mockRejectedValue(new Error("something else entirely"));

    await expect(POST(confirmRequest(VALID_BODY))).rejects.toThrow("something else entirely");
  });

  it("returns 409 already_joined for the same wallet address twice, without a second row", async () => {
    const first = await POST(confirmRequest(VALID_BODY));
    expect(first.status).toBe(200);

    const second = await POST(confirmRequest({ ...VALID_BODY, key_id_base64: "differentKeyId" }));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("already_joined");

    const rows = await testDb.select().from(workers).where(eq(workers.walletAddress, CONTRACT_ID));
    expect(rows).toHaveLength(1);
  });

  it("returns 409 already_joined for the same passkey credential id twice, without a second row", async () => {
    const first = await POST(confirmRequest(VALID_BODY));
    expect(first.status).toBe(200);

    const differentContractId = "C" + "B".repeat(55);
    const second = await POST(confirmRequest({ ...VALID_BODY, contract_id: differentContractId }));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("already_joined");

    const rows = await testDb.select().from(workers);
    expect(rows).toHaveLength(1);
  });
});
