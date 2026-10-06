import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
  vi.stubEnv("ADMIN_PASSWORD", PASSWORD);
  vi.stubEnv("ADMIN_SESSION_SECRET", "test-admin-session-secret-at-least-32-bytes");
});

function loginRequest(body: unknown, options: { origin?: string } = {}): NextRequest {
  return new NextRequest(`${APP_URL}/api/admin/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/admin/login", () => {
  it("signs in with the correct password and sets the admin session cookie", async () => {
    const res = await POST(loginRequest({ password: PASSWORD }));

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    expect(res.headers.get("set-cookie")).toContain("terreno_admin_session=");
  });

  it("rejects the wrong password without setting a cookie", async () => {
    const res = await POST(loginRequest({ password: "wrong" }));

    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("invalid_password");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(loginRequest({ password: PASSWORD }, { origin: "" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });

  it("rejects malformed JSON", async () => {
    const res = await POST(loginRequest("not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("rejects a missing password field", async () => {
    const res = await POST(loginRequest({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_input");
  });

  it("rejects an empty string password", async () => {
    const res = await POST(loginRequest({ password: "" }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-string password", async () => {
    const res = await POST(loginRequest({ password: 12345 }));
    expect(res.status).toBe(400);
  });
});
