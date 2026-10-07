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
  await migrate(db, { migrationsFolder: new URL("./migrations", import.meta.resolve("@terreno/shared/db/schema")).pathname });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

// Same reasoning as verify-place/route.test.ts: this file only exercises
// validation and coverage-check failures, which all return before the
// shared createPaidTask() helper ever calls processX402Request.
vi.mock("@/lib/x402", () => ({
  processX402Request: vi.fn(() => {
    throw new Error("processX402Request should not be called in this test file");
  }),
  resourceConfigFor: vi.fn(),
}));

const { POST } = await import("./route");

async function insertActiveWorker(country: string, city: string): Promise<void> {
  await testDb.insert(workers).values({
    id: ulid(),
    displayName: "Test Worker",
    walletAddress: `C${ulid()}`,
    passkeyCredentialId: ulid(),
    country,
    city,
    languages: ["en"],
    status: "active",
    createdAt: Date.now(),
  });
}

const VALID_BODY = {
  location: { country: "CL", city: "santiago", address: "Lider, Av. Providencia 1234" },
  item: "1 kg rice, cheapest brand",
  deadline_minutes: 90,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/check-price", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/tasks/check-price", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects malformed JSON before any DB or payment work", async () => {
    const res = await POST(postRequest("not json"));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("rejects a body missing required fields", async () => {
    const res = await POST(postRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("rejects a body missing item", async () => {
    const { item: _item, ...withoutItem } = VALID_BODY;
    const res = await POST(postRequest(withoutItem));

    expect(res.status).toBe(400);
  });

  it("rejects deadline_minutes outside 15-180 with a 400, not a 500", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, deadline_minutes: 200 }));

    expect(res.status).toBe(400);
  });

  it("rejects an unsupported country before touching coverage or payment", async () => {
    const res = await POST(
      postRequest({ ...VALID_BODY, location: { ...VALID_BODY.location, country: "US" } }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 409 no_coverage for a valid body with no active workers in that city", async () => {
    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  it("returns 409 no_coverage when only 1 active worker exists (live city needs >= 2)", async () => {
    await insertActiveWorker("CL", "santiago");

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  it("is live once 2 real active workers exist in the matching city (confirmed by reaching past coverage, into env resolution for the x402 payment config)", async () => {
    await insertActiveWorker("CL", "santiago");
    await insertActiveWorker("CL", "santiago");

    // No real TREASURY_PUBLIC_KEY is set in this test environment, so
    // createPaidTask's own resourceConfigFor(...) call throws there --
    // which proves this request reached past the coverage gate for a
    // genuinely live city (the no_coverage tests above never get this far).
    await expect(POST(postRequest(VALID_BODY))).rejects.toThrow("TREASURY_PUBLIC_KEY is not set");
  });

  // Past the coverage check, the route calls processX402Request, which
  // needs FACILITATOR_URL and a real facilitator round-trip to initialize.
  // The full paid happy path is proven against real testnet for
  // verify_place (see scripts/e2e-worker-flow-testnet.ts and
  // docs/proof.md); check_price shares the exact same createPaidTask()
  // implementation, not a separate, independently-fallible code path.
});
