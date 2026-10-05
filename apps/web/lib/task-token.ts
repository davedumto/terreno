import { randomBytes, createHash, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "tr_tok_";

/** 32 random bytes, prefixed, per SPEC.md section 15. Returned to the agent once. */
export function generateTaskToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString("hex");
}

/** SHA-256 of the token, as stored in tasks.task_token_hash. Never store the raw token. */
export function hashTaskToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Constant-time comparison against a stored hash, per SPEC.md section 15. */
export function verifyTaskToken(token: string, storedHash: string): boolean {
  const candidateHash = Buffer.from(hashTaskToken(token), "hex");
  const stored = Buffer.from(storedHash, "hex");
  if (candidateHash.length !== stored.length) {
    return false;
  }
  return timingSafeEqual(candidateHash, stored);
}
