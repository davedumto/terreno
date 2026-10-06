import { NextRequest, NextResponse } from "next/server";
import { DrizzleQueryError } from "drizzle-orm";
import { ulid } from "ulid";
import { workerConfirmSchema } from "@terreno/shared";
import { checkOrigin } from "@/lib/csrf";
import { db } from "@/lib/db";
import { workers } from "@/lib/db/schema";
import { setSessionCookie, signSession } from "@/lib/session";
import { verifyWorkerWallet, WalletVerificationError } from "@/lib/worker-wallet";

function isUniqueConstraintViolation(err: unknown): boolean {
  if (!(err instanceof DrizzleQueryError)) {
    return false;
  }
  const cause = err.cause as { code?: string } | undefined;
  return cause?.code === "SQLITE_CONSTRAINT";
}

/**
 * Step 2 of /join: the browser has already called kit.confirmWalletCreation()
 * itself and verified the deployment on-chain. The server does NOT take that
 * on trust (a request could skip that call and claim any contract_id):
 * verifyWorkerWallet() independently re-reads the contract from the network
 * and confirms it runs the exact expected wasm before a workers row is
 * written. Fails closed, per build-prompt.md's hard rule.
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

  const parsed = workerConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_input", details: parsed.error.issues }, { status: 400 });
  }

  try {
    await verifyWorkerWallet(parsed.data.contract_id);
  } catch (err) {
    if (err instanceof WalletVerificationError) {
      console.error("worker wallet verification failed", err);
      return NextResponse.json({ error: "wallet_verification_failed" }, { status: 403 });
    }
    throw err;
  }

  const workerId = ulid();
  try {
    await db.insert(workers).values({
      id: workerId,
      displayName: parsed.data.display_name,
      walletAddress: parsed.data.contract_id,
      passkeyCredentialId: parsed.data.key_id_base64,
      country: parsed.data.country,
      city: parsed.data.city,
      languages: parsed.data.languages,
      status: "active",
      createdAt: Date.now(),
    });
  } catch (err) {
    if (isUniqueConstraintViolation(err)) {
      // This exact wallet or passkey already has a workers row: a retried
      // confirm call (e.g. a flaky network response the browser retried)
      // rather than a genuinely new worker. Not an error worth surfacing
      // as one, but also not creating a second row.
      return NextResponse.json({ error: "already_joined" }, { status: 409 });
    }
    throw err;
  }

  const token = await signSession({ workerId });
  const res = NextResponse.json({ worker_id: workerId });
  setSessionCookie(res, token);
  return res;
}
