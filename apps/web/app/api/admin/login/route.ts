import { NextRequest, NextResponse } from "next/server";
import { checkOrigin } from "@/lib/csrf";
import { requireEnv } from "@/lib/env";
import { setAdminSessionCookie, signAdminSession } from "@/lib/admin-session";

export async function POST(req: NextRequest): Promise<Response> {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const password =
    typeof body === "object" && body !== null && "password" in body
      ? (body as { password: unknown }).password
      : undefined;

  if (typeof password !== "string" || password.length === 0) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  // Single shared password gating a testnet-only hackathon ops tool: a
  // plain comparison is proportionate here. Not timing-safe, which would
  // matter for a system with real stakes or multiple real accounts.
  if (password !== requireEnv("ADMIN_PASSWORD")) {
    return NextResponse.json({ error: "invalid_password" }, { status: 401 });
  }

  const token = await signAdminSession({ admin: true });
  const res = NextResponse.json({ ok: true });
  setAdminSessionCookie(res, token);
  return res;
}
