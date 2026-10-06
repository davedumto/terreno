"use client";

import { PasskeyKit } from "passkey-kit";
import { IndexedDBStorage } from "passkey-kit/storage";

let kit: PasskeyKit | undefined;

/**
 * Lazily constructs the browser-side PasskeyKit instance, shared across
 * calls on the same page load. No deploySource is ever passed here: the
 * shared default deployer signs only the Soroban auth entry (a well-known,
 * publicly-derivable key, not a secret), never the envelope. The server
 * resources and submits the actual deploy transaction with the admin key
 * (see lib/worker-wallet.ts::submitWalletDeploy). Passing the admin secret
 * into this config would ship it into client-side JavaScript.
 *
 * Reads process.env.NEXT_PUBLIC_* as a literal property access, not
 * through a shared requireEnv(name) helper: Next.js inlines NEXT_PUBLIC_*
 * values via build-time text substitution on that exact syntactic
 * pattern, not by evaluating a function call whose argument happens to be
 * the variable name as a runtime string. Confirmed the hard way: an
 * earlier version routed through requireEnv() and the real built client
 * bundle still called it with the variable's NAME at runtime, no value
 * ever inlined, which would have thrown "is not set" in every browser.
 */
export function getPasskeyKit(): PasskeyKit {
  if (!kit) {
    const rpcUrl = process.env.NEXT_PUBLIC_STELLAR_RPC_URL;
    const walletWasmHash = process.env.NEXT_PUBLIC_WORKER_WALLET_WASM_HASH;
    if (!rpcUrl) {
      throw new Error("NEXT_PUBLIC_STELLAR_RPC_URL is not set");
    }
    if (!walletWasmHash) {
      throw new Error("NEXT_PUBLIC_WORKER_WALLET_WASM_HASH is not set");
    }
    kit = new PasskeyKit({
      rpcUrl,
      networkPassphrase: "Test SDF Network ; September 2015",
      walletWasmHash,
      storage: new IndexedDBStorage(),
    });
  }
  return kit;
}
