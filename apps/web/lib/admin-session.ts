import { SignJWT, errors, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "./env";

// Deliberately a separate module from lib/session.ts (not a reuse): a
// distinct cookie name, payload shape, and secret make it a compile-time
// impossibility to cross-wire a worker session where an admin session is
// expected. 24h TTL, shorter than the worker session's 30 days: this gates
// a single shared-password ops tool, not a long-lived account, so a
// same-day re-login is an acceptable, even desirable, tradeoff.
const ADMIN_SESSION_COOKIE_NAME = "terreno_admin_session";
const ADMIN_SESSION_TTL_SECONDS = 24 * 60 * 60;
const ALGORITHM = "HS256";

export interface AdminSessionPayload {
  admin: true;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("ADMIN_SESSION_SECRET"));
}

export async function signAdminSession(payload: AdminSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${ADMIN_SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns null on any verification failure (expired, bad signature, malformed). */
export async function verifyAdminSession(token: string): Promise<AdminSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGORITHM] });
    if (payload.admin !== true) {
      return null;
    }
    return { admin: true };
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return null;
    }
    throw error;
  }
}

export function setAdminSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(ADMIN_SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
}

export function clearAdminSessionCookie(res: NextResponse): void {
  res.cookies.delete(ADMIN_SESSION_COOKIE_NAME);
}

export function getAdminSessionCookie(req: NextRequest): string | undefined {
  return req.cookies.get(ADMIN_SESSION_COOKIE_NAME)?.value;
}

/**
 * Reads and verifies the admin session cookie from an incoming request.
 * Null if absent or invalid. Used by every admin API route as the single
 * auth guard (parallel to lib/session.ts's getSession for worker routes).
 */
export async function requireAdminSession(
  req: NextRequest,
): Promise<AdminSessionPayload | null> {
  const token = getAdminSessionCookie(req);
  if (!token) {
    return null;
  }
  return verifyAdminSession(token);
}

/**
 * Same check as requireAdminSession, from a next/headers cookie store
 * instead of a NextRequest (the shape a server component's `await
 * cookies()` returns). Keeps the cookie name internal to this module
 * rather than exporting the raw constant for callers to duplicate.
 */
export async function verifyAdminSessionFromCookieStore(cookieStore: {
  get(name: string): { value: string } | undefined;
}): Promise<AdminSessionPayload | null> {
  const token = cookieStore.get(ADMIN_SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  return verifyAdminSession(token);
}
