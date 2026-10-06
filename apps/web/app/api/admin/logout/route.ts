import { NextRequest, NextResponse } from "next/server";
import { checkOrigin } from "@/lib/csrf";
import { clearAdminSessionCookie } from "@/lib/admin-session";

export async function POST(req: NextRequest): Promise<Response> {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  const res = NextResponse.json({ ok: true });
  clearAdminSessionCookie(res);
  return res;
}
