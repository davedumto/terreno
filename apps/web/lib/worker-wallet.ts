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

  if (instance.executable.type !== "contractExecutableWasm") {
    throw new WalletVerificationError(
      `contract ${contractId} is not a wasm-executable contract (type: ${instance.executable.type})`,
    );
  }

  const actualWasmHash = instance.executable.wasmHash.toString().toLowerCase();
  if (actualWasmHash !== expectedWasmHash) {
    throw new WalletVerificationError(
      `contract ${contractId} runs wasm ${actualWasmHash}, expected ${expectedWasmHash}`,
    );
  }
}
