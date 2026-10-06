import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { workerJoinSchema } from "@terreno/shared";
import { checkOrigin } from "@/lib/csrf";
import { requireEnv } from "@/lib/env";
import { submitWalletDeploy, WalletDeploySubmissionError } from "@/lib/worker-wallet";

/** Constant-time compare so invite-code checking can't be timed to guess it. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Step 1 of /join (SPEC.md section 10): submits the browser's passkey-kit
 * createWallet() carrier, resourced to the admin account, and returns the
 * real transaction hash. The browser then calls kit.confirmWalletCreation()
 * itself to verify the deployment on-chain and persist the passkey locally,
 * before calling /api/worker/confirm to actually create the workers row.
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

  const parsed = workerJoinSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.issues }, { status: 400 });
  }

  // Checked before any network/chain work, per build-prompt.md's fail-closed
  // rule: an invalid invite code should cost nothing.
  if (!safeEqual(parsed.data.invite_code, requireEnv("INVITE_CODE"))) {
    return NextResponse.json({ error: "invalid_invite_code" }, { status: 403 });
  }

  try {
    const { txHash } = await submitWalletDeploy(parsed.data.signed_tx);
    return NextResponse.json({ creation_tx_hash: txHash });
  } catch (err) {
    if (err instanceof WalletDeploySubmissionError) {
      console.error("wallet deploy submission failed", err);
      return NextResponse.json({ error: "deploy_failed" }, { status: 502 });
    }
    throw err;
  }
}
