import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { ulid } from "ulid";
import * as schema from "@/lib/db/schema";
import { tasks, workers } from "@/lib/db/schema";
import { signSession } from "@/lib/session";

let testDb: Awaited<ReturnType<typeof freshDb>>;

async function freshDb() {
  const client = createClient({ url: ":memory:" });
  const db = drizzle({ client, schema });
  await migrate(db, {
    migrationsFolder: new URL("../../../../../../lib/db/migrations", import.meta.url).pathname,
  });
  return db;
}

vi.mock("@/lib/db", () => ({
  get db() {
    return testDb;
  },
}));

const uploadTaskPhotoMock = vi.fn(async (..._args: unknown[]) => ({
  publicId: "terreno/task-photos/TASK1",
  url: "https://res.cloudinary.com/demo/image/upload/terreno/task-photos/TASK1.jpg",
}));

class FakePhotoUploadError extends Error {
  constructor(
    message: string,
    public readonly code: "too_large" | "bad_type" | "upload_failed",
  ) {
    super(message);
    this.name = "PhotoUploadError";
  }
}

vi.mock("@/lib/cloudinary", () => ({
  uploadTaskPhoto: (...args: unknown[]) => uploadTaskPhotoMock(...args),
  PhotoUploadError: FakePhotoUploadError,
}));

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("SESSION_SECRET", "test-session-secret-at-least-32-bytes-long");
  uploadTaskPhotoMock.mockClear();
  uploadTaskPhotoMock.mockResolvedValue({
    publicId: "terreno/task-photos/TASK1",
    url: "https://res.cloudinary.com/demo/image/upload/terreno/task-photos/TASK1.jpg",
  });
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

async function insertClaimedTask(workerId: string, overrides: Partial<typeof tasks.$inferInsert> = {}) {
  const now = Date.now();
  const [row] = await testDb
    .insert(tasks)
    .values({
      id: ulid(),
      type: "verify_place",
      status: "claimed",
      input: { question: "Is it open?" },
      country: "NG",
      city: "enugu",
      price: 5_000_000,
      fee: 0,
      payerAddress: "GPAYER",
      paymentTxHash: ulid(),
      escrowTxHash: "ESCROWTX1",
      taskTokenHash: "hash",
      workerId,
      claimedAt: now,
      claimExpiresAt: now + 15 * 60 * 1000,
      deadlineAt: now + 60 * 60 * 1000,
      createdAt: now,
      updatedAt: now,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("insert failed");
  return row;
}

function photoRequest(
  id: string,
  formData?: FormData,
  token?: string,
  options: { origin?: string } = {},
): NextRequest {
  return new NextRequest(`${APP_URL}/api/worker/tasks/${id}/photo`, {
    method: "POST",
    headers: {
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
      ...(token ? { cookie: `terreno_session=${token}` } : {}),
    },
    body: formData,
  });
}

function routeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

function fakeFile(): File {
  return new File([new Uint8Array([1, 2, 3])], "shop.jpg", { type: "image/jpeg" });
}

describe("POST /api/worker/tasks/[id]/photo", () => {
  beforeEach(async () => {
    testDb = await freshDb();
  });

  it("uploads a photo for the worker's own claimed task and returns a photo_key", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.photo_key).toBe("terreno/task-photos/TASK1");
    expect(body.photo_url).toContain("cloudinary.com");
    expect(uploadTaskPhotoMock).toHaveBeenCalledOnce();
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(
      photoRequest("whatever", new FormData(), undefined, { origin: "" }),
      routeParams("whatever"),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("rejects an unauthenticated request", async () => {
    const res = await POST(photoRequest("whatever", new FormData()), routeParams("whatever"));
    expect(res.status).toBe(401);
  });

  it("returns 404 for a nonexistent task", async () => {
    const worker = await insertWorker();
    const token = await signSession({ workerId: worker.id });

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest("not-a-real-id", formData, token), routeParams("not-a-real-id"));
    expect(res.status).toBe(404);
  });

  it("rejects a task claimed by a different worker", async () => {
    const owner = await insertWorker();
    const otherWorker = await insertWorker({
      walletAddress: `C${ulid()}`,
      passkeyCredentialId: ulid(),
    });
    const task = await insertClaimedTask(owner.id);
    const token = await signSession({ workerId: otherWorker.id });

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not_your_claim");
  });

  it("rejects a task that isn't currently claimed", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id, { status: "open", workerId: null });
    const token = await signSession({ workerId: worker.id });

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));
    expect(res.status).toBe(409);
  });

  it("rejects a request with no photo field", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    const res = await POST(photoRequest(task.id, new FormData(), token), routeParams(task.id));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("maps a PhotoUploadError's bad_type code to 415", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    uploadTaskPhotoMock.mockRejectedValueOnce(new FakePhotoUploadError("bad type", "bad_type"));

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));
    expect(res.status).toBe(415);
    expect((await res.json()).error).toBe("bad_type");
  });

  it("maps a PhotoUploadError's too_large code to 413", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    uploadTaskPhotoMock.mockRejectedValueOnce(new FakePhotoUploadError("too big", "too_large"));

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("too_large");
  });

  it("maps a PhotoUploadError's upload_failed code to 502", async () => {
    const worker = await insertWorker();
    const task = await insertClaimedTask(worker.id);
    const token = await signSession({ workerId: worker.id });

    uploadTaskPhotoMock.mockRejectedValueOnce(new FakePhotoUploadError("cloudinary is down", "upload_failed"));

    const formData = new FormData();
    formData.set("photo", fakeFile());

    const res = await POST(photoRequest(task.id, formData, token), routeParams(task.id));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("upload_failed");
  });
});
