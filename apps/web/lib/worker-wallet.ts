import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import { Api, Server } from "@stellar/stellar-sdk/rpc";
import { requireEnv, testnetPassphrase } from "./env";

export class WalletVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletVerificationError";
  }
}

export class WalletDeploySubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WalletDeploySubmissionError";
  }
}

/**
 * Submits passkey-kit's createWallet() deploy carrier (the shared-deployer
 * branch's signedTx, base64 XDR), re-sourced to the admin account.
 *
 * The carrier as passkey-kit produces it has NO real envelope source: its
 * TransactionBuilder.build() ran against @stellar/stellar-sdk's own
 * NULL_ACCOUNT placeholder (sequence 1, BASE_FEE, zero envelope signatures),
 * because the shared deployer's role is to sign only the Soroban address-
 * auth entry, never to fund or submit anything (that's the whole point of
 * a worker wallet needing no XLM). Verified empirically, including the
 * exact envelope shape, by a dedicated research pass: see
 * docs/decisions.md, 2026-10-06.
 *
 * This rebuilds a FRESH transaction sourced by the admin account (a real,
 * funded key, same trust tier as every other admin-authorized call in
 * lib/escrow.ts), reusing the SAME operation object and Soroban transaction
 * data, so the already-signed auth entry is never touched, only wrapped in
 * a new envelope with a real source/sequence/fee, which the admin then
 * signs. Confirmed byte-for-byte unchanged auth-entry XDR through this
 * rebuild, and the equivalent mechanism confirmed live on testnet, before
 * relying on it here. FeeBumpTransaction is NOT the right tool: it requires
 * the inner transaction to already carry a valid signature from a real,
 * spendable source account, which NULL_ACCOUNT can never have.
 */
export async function submitWalletDeploy(carrierXdr: string): Promise<{ txHash: string }> {
  const rpcUrl = requireEnv("STELLAR_RPC_URL");
  const networkPassphrase = testnetPassphrase();
  const adminKeypair = Keypair.fromSecret(requireEnv("ADMIN_SECRET_KEY"));

  const server = new Server(rpcUrl, { allowHttp: rpcUrl.startsWith("http://") });

  let decoded;
  try {
    decoded = TransactionBuilder.fromXDR(carrierXdr, networkPassphrase);
  } catch (err) {
    throw new WalletDeploySubmissionError(
      `carrier transaction could not be decoded: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!("toEnvelope" in decoded)) {
    throw new WalletDeploySubmissionError("carrier transaction is a fee-bump envelope, not a plain transaction");
  }

  // Both the Soroban transaction data and the operation must come from the
  // RAW envelope, not the friendly Transaction instance: v16's Transaction
  // has no sorobanData getter at all, and TransactionBuilder.addOperation()
  // requires the raw xdr.Operation class, not the friendly parsed object
  // decoded.operations[0] returns (confirmed the hard way: passing the
  // friendly object throws "operation.sourceAccount is not a function").
  const rawTx = decoded.toEnvelope().v1().tx();
  const sorobanData = rawTx.ext().sorobanData();
  const rawOperations = rawTx.operations();
  const rawOperation = rawOperations[0];
  if (rawOperations.length !== 1 || !rawOperation) {
    throw new WalletDeploySubmissionError(
      `carrier transaction has ${rawOperations.length} operations, expected exactly 1`,
    );
  }

  let adminAccount;
  try {
    adminAccount = await server.getAccount(adminKeypair.publicKey());
  } catch (err) {
    throw new WalletDeploySubmissionError(
      `could not load the admin account: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const resourcedTx = new TransactionBuilder(adminAccount, {
    fee: decoded.fee,
    networkPassphrase,
  })
    .setSorobanData(sorobanData)
    .addOperation(rawOperation)
    .setTimeout(30)
    .build();

  resourcedTx.sign(adminKeypair);

  const sent = await server.sendTransaction(resourcedTx);
  if (sent.status === "ERROR") {
    throw new WalletDeploySubmissionError(
      `wallet deploy transaction was rejected: ${JSON.stringify(sent.errorResult ?? sent)}`,
    );
  }

  const result = await server.pollTransaction(sent.hash, { attempts: 20 });
  if (result.status !== Api.GetTransactionStatus.SUCCESS) {
    throw new WalletDeploySubmissionError(
      `wallet deploy transaction did not succeed: ${result.status}`,
    );
  }

  return { txHash: sent.hash };
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
