import { SignJWT, errors, jwtVerify } from "jose";
import type { NextRequest, NextResponse } from "next/server";
import { requireEnv } from "./env";

// SPEC.md section 10: 30 days. Section 15: httpOnly, secure, SameSite=Lax.
const SESSION_COOKIE_NAME = "terreno_session";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ALGORITHM = "HS256";

export interface SessionPayload {
  workerId: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(requireEnv("SESSION_SECRET"));
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: ALGORITHM })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

/** Returns null on any verification failure (expired, bad signature, malformed). */
export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: [ALGORITHM] });
    if (typeof payload.workerId !== "string" || !payload.workerId) {
      return null;
    }
    return { workerId: payload.workerId };
  } catch (error) {
    if (error instanceof errors.JOSEError) {
      return null;
    }
    throw error;
  }
}

export function setSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.delete(SESSION_COOKIE_NAME);
}

export function getSessionCookie(req: NextRequest): string | undefined {
  return req.cookies.get(SESSION_COOKIE_NAME)?.value;
}

/** Reads and verifies the session cookie from an incoming request. Null if absent or invalid. */
export async function getSession(req: NextRequest): Promise<SessionPayload | null> {
  const token = getSessionCookie(req);
  if (!token) {
    return null;
  }
  return verifySession(token);
}
