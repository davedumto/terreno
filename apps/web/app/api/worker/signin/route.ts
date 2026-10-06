import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { workerSigninSchema } from "@terreno/shared";
import { checkOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import { workers } from "@/lib/db/schema";
import { setSessionCookie, signSession } from "@/lib/session";

/**
 * SPEC.md section 10: "Sign-in reuses the passkey assertion." The browser
 * has already run kit.connectWallet() itself and proven, client-side, that
 * this passkey genuinely controls this wallet (it resolves the contract
 * from the browser's own local storage, written by a prior createWallet()
 * + confirmWalletCreation() on this device, and performs a fresh WebAuthn
 * assertion against the live on-chain signer before returning). The server
 * does not re-run that proof; it only needs to find which worker this
 * already-proven wallet belongs to and issue a session, the same way
 * claim-on-a-task trusts an already-established session rather than
 * re-verifying a passkey on every request.
 */
export async function POST(req: NextRequest): Promise<Response> {
  if (!checkOrigin(req)) {
    return NextResponse.json({ error: "bad_origin" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_input", details: "body must be valid JSON" }, { status: 400 });
  }

  const parsed = workerSigninSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.issues }, { status: 400 });
  }

  const [worker] = await db
    .select()
    .from(workers)
    .where(eq(workers.walletAddress, parsed.data.contract_id));

  if (!worker || worker.passkeyCredentialId !== parsed.data.key_id_base64) {
    // Same response either way: an unknown wallet and a wallet whose
    // passkey doesn't match the one on record both just mean "we don't
    // recognize this as an existing worker," not two different errors.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (worker.status === "banned") {
    return NextResponse.json({ error: "account_banned" }, { status: 403 });
  }

  const token = await signSession({ workerId: worker.id });
  const res = NextResponse.json({ worker_id: worker.id });
  setSessionCookie(res, token);
  return res;
}
