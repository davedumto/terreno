import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  clearAdminSessionCookie,
  getAdminSessionCookie,
  requireAdminSession,
  setAdminSessionCookie,
  signAdminSession,
  verifyAdminSession,
  verifyAdminSessionFromCookieStore,
} from "./admin-session";

const ORIGINAL_SECRET = "test-admin-session-secret-at-least-32-bytes";

function requestWithCookie(cookie?: string): NextRequest {
  return new NextRequest("http://localhost/admin", {
    headers: cookie ? { cookie: `terreno_admin_session=${cookie}` } : {},
  });
}

describe("admin-session", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_SESSION_SECRET", ORIGINAL_SECRET);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("signs a token that verifies back to an admin payload", async () => {
    const token = await signAdminSession({ admin: true });
    const payload = await verifyAdminSession(token);

    expect(payload).toEqual({ admin: true });
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await signAdminSession({ admin: true });

    vi.stubEnv("ADMIN_SESSION_SECRET", "a-completely-different-secret-value-32b");
    const payload = await verifyAdminSession(token);

    expect(payload).toBeNull();
  });

  it("rejects a malformed token", async () => {
    const payload = await verifyAdminSession("not-a-real-jwt");

    expect(payload).toBeNull();
  });

  it("rejects an expired token", async () => {
    vi.useFakeTimers();
    try {
      const token = await signAdminSession({ admin: true });

      // 24h + 1 second past issuance.
      vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1000);

      const payload = await verifyAdminSession(token);
      expect(payload).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects a token missing the admin claim", async () => {
    // Deliberately bypasses signAdminSession to produce a validly-signed
    // token with no admin claim, simulating a token forged for a different
    // purpose that still carries a valid signature from the same secret.
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode(ORIGINAL_SECRET));

    const payload = await verifyAdminSession(token);
    expect(payload).toBeNull();
  });

  it("rejects a token where the admin claim is not literally true", async () => {
    // A worker session token has a completely different payload shape
    // ({workerId: string}), but even a token that happens to carry
    // `admin: "true"` (string) or `admin: false` must still be rejected.
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ admin: "true" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("24h")
      .sign(new TextEncoder().encode(ORIGINAL_SECRET));

    const payload = await verifyAdminSession(token);
    expect(payload).toBeNull();
  });

  it("throws if ADMIN_SESSION_SECRET is not set when signing", async () => {
    vi.stubEnv("ADMIN_SESSION_SECRET", "");

    await expect(signAdminSession({ admin: true })).rejects.toThrow(
      "ADMIN_SESSION_SECRET is not set",
    );
  });

  it("round-trips through a real NextResponse/NextRequest cookie pair", async () => {
    const token = await signAdminSession({ admin: true });
    const res = NextResponse.json({ ok: true });
    setAdminSessionCookie(res, token);

    const setCookieHeader = res.cookies.get("terreno_admin_session");
    expect(setCookieHeader?.httpOnly).toBe(true);
    expect(setCookieHeader?.sameSite).toBe("lax");
    expect(setCookieHeader?.path).toBe("/");
    expect(setCookieHeader?.maxAge).toBe(24 * 60 * 60);

    const req = requestWithCookie(token);
    expect(getAdminSessionCookie(req)).toBe(token);

    const session = await requireAdminSession(req);
    expect(session).toEqual({ admin: true });
  });

  it("requireAdminSession returns null when no cookie is present", async () => {
    const session = await requireAdminSession(requestWithCookie());
    expect(session).toBeNull();
  });

  it("requireAdminSession returns null for a tampered cookie value", async () => {
    const token = await signAdminSession({ admin: true });
    // Flip a character well before the end of the signature segment, not
    // the very last character: base64url packs 6 bits per character, so
    // the last character of a signature can have "don't care" padding
    // bits where a flip decodes to the identical byte, making the
    // signature accidentally still valid by chance (~1-in-64 odds per
    // run) and this test occasionally flaky for a reason unrelated to
    // signature verification itself.
    const flipIndex = token.length - 5;
    const flippedChar = token[flipIndex] === "A" ? "B" : "A";
    const tampered = token.slice(0, flipIndex) + flippedChar + token.slice(flipIndex + 1);

    const session = await requireAdminSession(requestWithCookie(tampered));
    expect(session).toBeNull();
  });

  it("verifyAdminSessionFromCookieStore verifies a token from a next/headers-shaped cookie store", async () => {
    const token = await signAdminSession({ admin: true });
    const cookieStore = { get: (name: string) => (name === "terreno_admin_session" ? { value: token } : undefined) };

    const session = await verifyAdminSessionFromCookieStore(cookieStore);
    expect(session).toEqual({ admin: true });
  });

  it("verifyAdminSessionFromCookieStore returns null when the cookie is absent", async () => {
    const cookieStore = { get: () => undefined };

    const session = await verifyAdminSessionFromCookieStore(cookieStore);
    expect(session).toBeNull();
  });

  it("clearAdminSessionCookie removes the cookie from the response", () => {
    const res = NextResponse.json({ ok: true });
    setAdminSessionCookie(res, "irrelevant-value");
    expect(res.cookies.get("terreno_admin_session")).toBeDefined();

    clearAdminSessionCookie(res);

    const setCookieHeader = res.headers.get("set-cookie");
    expect(setCookieHeader).toMatch(/terreno_admin_session=;/);
  });
});
