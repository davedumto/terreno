import type { NextRequest } from "next/server";
import { requireEnv } from "./env";

/**
 * SPEC.md section 15: mutating, session-authenticated routes check the
 * Origin header against APP_URL. A fetch-based request from any other
 * origin (the actual CSRF vector cookies alone don't stop) either omits
 * Origin or sends a different one; same-origin browser requests always send
 * a matching Origin on state-changing methods.
 */
export function checkOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) {
    return false;
  }
  return origin === requireEnv("APP_URL");
}
