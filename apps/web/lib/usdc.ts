import type { AssembledTransaction } from "@stellar/stellar-sdk/contract";
import { Client } from "@stellar/stellar-sdk/contract";
import { requireEnv, testnetPassphrase } from "./env";

interface UsdcContractMethods {
  balance: (args: { id: string }) => Promise<AssembledTransaction<bigint>>;
}

type UsdcContractClient = Client & UsdcContractMethods;

/**
 * Reads an address's current USDC balance (stroops) directly from the SAC,
 * read-only (no signer needed: SEP-41's balance() only needs simulation).
 * Not derived from the database: the token contract is the source of truth
 * for what a worker actually holds, which could drift from a sum over
 * release_tx_hash rows if funds ever moved outside this app's own flows.
 */
export async function getUsdcBalance(address: string): Promise<bigint> {
  const client = await Client.from<UsdcContractMethods>({
    contractId: requireEnv("USDC_CONTRACT_ID"),
    networkPassphrase: testnetPassphrase(),
    rpcUrl: requireEnv("STELLAR_RPC_URL"),
  });

  const tx = await (client as UsdcContractClient).balance({ id: address });
  return tx.result;
}
