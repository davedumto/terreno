import { Server } from "@stellar/stellar-sdk/rpc";
import { requireEnv } from "./env";

export class WalletVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletVerificationError";
  }
}

/**
 * Confirms a worker-claimed contract id is genuinely a live smart wallet
 * running the exact wasm this project deploys, before trusting it enough to
 * write a workers row. The browser's own kit.confirmWalletCreation() already
 * does an equivalent check client-side, but the server must not take a
 * client's word for it: a request could skip that call and claim any
 * contract_id. Throws WalletVerificationError on any mismatch; never throws
 * for a simple "not found" (treated the same as a mismatch).
 */
export async function verifyWorkerWallet(contractId: string): Promise<void> {
  const rpcUrl = requireEnv("STELLAR_RPC_URL");
  const expectedWasmHash = requireEnv("WORKER_WALLET_WASM_HASH").toLowerCase();

  const server = new Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  let instance;
  try {
    instance = await server.getContractInstance(contractId);
  } catch (err) {
    throw new WalletVerificationError(
      `contract ${contractId} could not be read from the network: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // @stellar/stellar-sdk@16.3.1's js-xdr union API: executable()/switch()/
  // wasmHash() are methods here, not properties (that's v17's API, pinned
  // down workspace-wide for passkey-kit compatibility; see docs/decisions.md,
  // 2026-10-06). wasmHash() returns a raw Buffer, not a Hash with its own
  // string encoding, so the hex conversion is explicit.
  const executable = instance.executable();
  if (executable.switch().name !== "contractExecutableWasm") {
    throw new WalletVerificationError(
      `contract ${contractId} is not a wasm-executable contract (type: ${executable.switch().name})`,
    );
  }

  const actualWasmHash = executable.wasmHash().toString("hex").toLowerCase();
  if (actualWasmHash !== expectedWasmHash) {
    throw new WalletVerificationError(
      `contract ${contractId} runs wasm ${actualWasmHash}, expected ${expectedWasmHash}`,
    );
  }
}
