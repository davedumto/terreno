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
  location: { country: "NG", city: "enugu" },
  source_text: "Your order will arrive tomorrow before noon.",
  target_language: "ig",
  deadline_minutes: 30,
};

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/tasks/translate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/tasks/translate", () => {
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

  it("rejects a body missing source_text", async () => {
    const { source_text: _sourceText, ...withoutSourceText } = VALID_BODY;
    const res = await POST(postRequest(withoutSourceText));

    expect(res.status).toBe(400);
  });

  it("rejects a body missing target_language", async () => {
    const { target_language: _targetLanguage, ...withoutTargetLanguage } = VALID_BODY;
    const res = await POST(postRequest(withoutTargetLanguage));

    expect(res.status).toBe(400);
  });

  it("rejects a target_language shorter than 2 characters", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, target_language: "i" }));

    expect(res.status).toBe(400);
  });

  it("accepts a location with no address/lat/lng (translate's own location fields are all optional beyond country/city)", async () => {
    await insertActiveWorker("NG", "enugu");
    await insertActiveWorker("NG", "enugu");

    // Proves the body itself validated and reached past coverage: location
    // has only country/city, no address or coordinates, which this task
    // type's schema (like the others) treats as optional.
    await expect(POST(postRequest(VALID_BODY))).rejects.toThrow("TREASURY_PUBLIC_KEY is not set");
  });

  it("rejects deadline_minutes outside 15-180 with a 400, not a 500", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, deadline_minutes: 5 }));

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
    await insertActiveWorker("NG", "enugu");

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  // Past the coverage check, the route calls processX402Request, which
  // needs FACILITATOR_URL and a real facilitator round-trip to initialize.
  // The full paid happy path is proven against real testnet for
  // verify_place (see scripts/e2e-worker-flow-testnet.ts and
  // docs/proof.md); translate shares the exact same createPaidTask()
  // implementation, not a separate, independently-fallible code path.
  // Note, specific to this type: translate's TASK_PRICES_STROOPS entry
  // (3_000_000, 0.30 USDC) differs from verify_place/check_price's
  // (5_000_000, 0.50 USDC each) -- covered by the price constant itself
  // already being a plain, directly-testable value in packages/shared,
  // not re-asserted here.
});
