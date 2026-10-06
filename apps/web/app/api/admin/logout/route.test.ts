import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { POST } = await import("./route");

const APP_URL = "http://localhost:3000";

beforeEach(() => {
  vi.stubEnv("APP_URL", APP_URL);
});

function logoutRequest(options: { origin?: string } = {}): NextRequest {
  return new NextRequest(`${APP_URL}/api/admin/logout`, {
    method: "POST",
    headers: {
      ...(options.origin === undefined ? { origin: APP_URL } : options.origin ? { origin: options.origin } : {}),
    },
  });
}

describe("POST /api/admin/logout", () => {
  it("clears the admin session cookie", async () => {
    const res = await POST(logoutRequest());

    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
    const setCookie = res.headers.get("set-cookie");
    expect(setCookie).toContain("terreno_admin_session=");
    expect(setCookie).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it("rejects a request with no Origin header", async () => {
    const res = await POST(logoutRequest({ origin: "" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("bad_origin");
  });
});
