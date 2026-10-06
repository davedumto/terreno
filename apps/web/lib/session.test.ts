import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  getSession,
  getSessionCookie,
  setSessionCookie,
  signSession,
  verifySession,
} from "./session";

const ORIGINAL_SECRET = "test-session-secret-at-least-32-bytes-long";

function requestWithCookie(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/work", {
    headers: cookie ? { cookie: `terreno_session=${cookie}` } : {},
  });
}

describe("session", () => {
  beforeEach(() => {
    vi.stubEnv("SESSION_SECRET", ORIGINAL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs a token that verifies back to the same workerId", async () => {
    const token = await signSession({ workerId: "worker-1" });
    const payload = await verifySession(token);

    expect(payload).toEqual({ workerId: "worker-1" });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signSession({ workerId: "worker-1" });

    vi.stubEnv("SESSION_SECRET", "a-completely-different-secret-value-32b");
    const payload = await verifySession(token);

    expect(payload).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const payload = await verifySession("not-a-real-jwt");

    expect(payload).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    try {
      const token = await signSession({ workerId: "worker-1" });

      // 30 days + 1 second past issuance.
      vi.advanceTimersByTime(30 * 24 * 60 * 60 * 1000 + 1000);

      const payload = await verifySession(token);
      expect(payload).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a token missing the workerId claim", async () => {
    // Deliberately bypasses signSession to produce a validly-signed token
    // with no workerId, simulating a token forged for a different purpose
    // that still carries a valid signature from the same secret.
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("30d")
      .sign(new TextEncoder().encode(ORIGINAL_SECRET));

    const payload = await verifySession(token);
    expect(payload).toBeNull();
  });

  it("throws if SESSION_SECRET is not set when signing", async () => {
    vi.stubEnv("SESSION_SECRET", "");

    await expect(signSession({ workerId: "worker-1" })).rejects.toThrow(
      "SESSION_SECRET is not set",
    );
  });

  it("round-trips through a real NextResponse/NextRequest cookie pair", async () => {
    const token = await signSession({ workerId: "worker-7" });
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, token);

    const setCookieHeader = res.cookies.get("terreno_session");
    expect(setCookieHeader?.httpOnly).toBe(true);
    expect(setCookieHeader?.sameSite).toBe("lax");
    expect(setCookieHeader?.path).toBe("/");
    expect(setCookieHeader?.maxAge).toBe(30 * 24 * 60 * 60);

    const req = requestWithCookie(token);
    expect(getSessionCookie(req)).toBe(token);

    const session = await getSession(req);
    expect(session).toEqual({ workerId: "worker-7" });
  });

  it("getSession returns null when no cookie is present", async () => {
    const session = await getSession(requestWithCookie());
    expect(session).toBeNull();
  });

  it("getSession returns null for a tampered cookie value", async () => {
    const token = await signSession({ workerId: "worker-1" });
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");

    const session = await getSession(requestWithCookie(tampered));
    expect(session).toBeNull();
  });

  it("clearSessionCookie removes the cookie from the response", () => {
    const res = NextResponse.json({ ok: true });
    setSessionCookie(res, "irrelevant-value");
    expect(res.cookies.get("terreno_session")).toBeDefined();

    clearSessionCookie(res);

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toMatch(/terreno_session=;/);
  });
});
