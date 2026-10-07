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

// This test file only exercises validation and coverage-check failures,
// all of which return before the route ever calls processX402Request.
// Mocked here (rather than letting the route's real import run) because
// @/lib/x402 pulls in @x402/next, which internally imports "next/server"
// without a file extension; Next's own bundler tolerates that, but
// Vitest's plain Node ESM resolution cannot follow it, failing the whole
// suite with an unrelated resolution error before any test runs.
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

describe("POST /api/tasks/verify-place", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("rejects malformed JSON before any DB or payment work", async () => {
    const res = await POST(postRequest("not json"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
  });

  it("rejects a body missing required fields", async () => {
    const res = await POST(postRequest({}));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_input");
    expect(Array.isArray(body.details)).toBe(true);
    expect(body.details.length).toBeGreaterThan(0);
  });

  it("rejects deadline_minutes outside 15-180 with a 400, not a 500", async () => {
    const res = await POST(postRequest({ ...VALID_BODY, deadline_minutes: 5 }));

    expect(res.status).toBe(400);
  });

  it("rejects an unsupported country before touching coverage or payment", async () => {
    const res = await POST(
      postRequest({
        ...VALID_BODY,
        location: { ...VALID_BODY.location, country: "US" },
      }),
    );

    expect(res.status).toBe(400);
  });

  it("returns 409 no_coverage for a valid body with no active workers in that city", async () => {
    // No workers inserted at all.
    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("no_coverage");
  });

  it("returns 409 no_coverage when only 1 active worker exists (live city needs >= 2)", async () => {
    await insertActiveWorker("NG", "enugu");

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  it("returns 409 no_coverage when the 2 active workers are in a different city", async () => {
    await insertActiveWorker("NG", "lagos");
    await insertActiveWorker("NG", "lagos");

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  it("does not count paused or banned workers toward coverage", async () => {
    await testDb.insert(workers).values([
      {
        id: ulid(),
        displayName: "Paused Worker",
        walletAddress: `C${ulid()}`,
        passkeyCredentialId: ulid(),
        country: "NG",
        city: "enugu",
        languages: ["en"],
        status: "paused",
        createdAt: Date.now(),
      },
      {
        id: ulid(),
        displayName: "Banned Worker",
        walletAddress: `C${ulid()}`,
        passkeyCredentialId: ulid(),
        country: "NG",
        city: "enugu",
        languages: ["en"],
        status: "banned",
        createdAt: Date.now(),
      },
    ]);

    const res = await POST(postRequest(VALID_BODY));

    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_coverage");
  });

  // Past the coverage check, the route calls processX402Request, which
  // needs FACILITATOR_URL and a real facilitator round-trip to
  // initialize. Covering create_task/release/refund and the full paid
  // happy path is proven against real testnet (see scripts/
  // e2e-escrow-testnet.ts and docs/proof.md), not mocked here.
});
