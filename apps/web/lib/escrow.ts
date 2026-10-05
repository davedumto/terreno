import { Keypair } from "@stellar/stellar-sdk";
import type { AssembledTransaction, Result } from "@stellar/stellar-sdk/contract";
import { Client, KeypairSigner } from "@stellar/stellar-sdk/contract";

export type TaskStatus = "Locked" | "Assigned" | "Released" | "Refunded";

export interface Task {
  payer: string;
  amount: bigint;
  deadline: bigint;
  worker: string | undefined;
  status: TaskStatus;
}

// The raw wire shape get_task actually returns, verified live against the
// deployed contract (see docs/decisions.md, 2026-10-05):
// - a void-case Rust enum variant (TaskStatus) comes back as
//   { tag: "VariantName" }, not a bare string.
// - Option<Address> comes back as `null` when None, not `undefined`.
interface RawTask {
  payer: string;
  amount: bigint;
  deadline: bigint;
  worker: string | null;
  status: { tag: TaskStatus };
}

function fromRawTask(raw: RawTask): Task {
  return { ...raw, worker: raw.worker ?? undefined, status: raw.status.tag };
}

// Mirrors contracts/escrow/src/error.rs. Keep in sync; order and values
// must match the Rust #[contracterror] enum exactly.
export enum EscrowErrorCode {
  AlreadyExists = 1,
  NotFound = 2,
  InvalidAmount = 3,
  InvalidDeadline = 4,
  WrongStatus = 5,
  NotAssigned = 6,
  FeeTooHigh = 7,
}

export class EscrowError extends Error {
  constructor(public readonly code: EscrowErrorCode, message: string) {
    super(message);
    this.name = "EscrowError";
  }
}

interface EscrowContractMethods {
  create_task: (args: {
    id: Buffer;
    payer: string;
    amount: bigint;
    deadline: bigint;
  }) => Promise<AssembledTransaction<Result<void>>>;
  assign: (args: { id: Buffer; worker: string }) => Promise<AssembledTransaction<Result<void>>>;
  unassign: (args: { id: Buffer }) => Promise<AssembledTransaction<Result<void>>>;
  release: (args: { id: Buffer }) => Promise<AssembledTransaction<Result<void>>>;
  refund: (args: { id: Buffer }) => Promise<AssembledTransaction<Result<void>>>;
  get_task: (args: { id: Buffer }) => Promise<AssembledTransaction<Result<RawTask>>>;
  set_admin: (args: { new: string }) => Promise<AssembledTransaction<void>>;
}

type EscrowContractClient = Client & EscrowContractMethods;

export interface EscrowConfig {
  contractId: string;
  rpcUrl: string;
  networkPassphrase: string;
  adminSecretKey: string;
  treasurySecretKey: string;
}

interface ErrorCase {
  name: { toString(): string };
  doc: { toString(): string };
  value: number;
}

interface EscrowSpec {
  errorCases(): ErrorCase[];
}

async function getClient(
  config: EscrowConfig,
): Promise<{ client: EscrowContractClient; messageToCode: Map<string, number> }> {
  const adminKeypair = Keypair.fromSecret(config.adminSecretKey);
  const client = await Client.from<EscrowContractMethods>({
    contractId: config.contractId,
    networkPassphrase: config.networkPassphrase,
    rpcUrl: config.rpcUrl,
    publicKey: adminKeypair.publicKey(),
    signTransaction: new KeypairSigner(adminKeypair, config.networkPassphrase),
  });

  // The message that reaches unwrapErr() is each error.rs variant's doc
  // comment, not its name (see @stellar/stellar-sdk/contract/client.js:
  // it always rebuilds errorTypes from spec.errorCases() as
  // { [value]: { message: doc } } and ignores anything passed in
  // ClientOptions). Building the doc-text -> code map straight from the
  // deployed contract's own spec, rather than hardcoding the doc strings
  // here, means this never drifts from error.rs.
  const spec = client.spec as unknown as EscrowSpec;
  const messageToCode = new Map<string, number>();
  for (const errorCase of spec.errorCases()) {
    const name = errorCase.name.toString();
    if (name in EscrowErrorCode) {
      messageToCode.set(errorCase.doc.toString(), errorCase.value);
    }
  }

  return { client: client as unknown as EscrowContractClient, messageToCode };
}

function throwIfErr<T>(result: Result<T>, messageToCode: Map<string, number>): T {
  if (result.isErr()) {
    const { message } = result.unwrapErr();
    const code = messageToCode.get(message);
    throw new EscrowError(code ?? 0, message || "escrow contract call failed");
  }
  return result.unwrap();
}

interface SentTransactionLike<T> {
  result: Result<T>;
  sendTransactionResponse?: { hash: string };
}

function requireTxHash<T>(sent: SentTransactionLike<T>): string {
  const hash = sent.sendTransactionResponse?.hash;
  if (!hash) {
    throw new Error("escrow transaction sent but no transaction hash was returned");
  }
  return hash;
}

/**
 * Moves `amount` from the treasury into escrow under `id`, status Locked.
 * Requires both admin and treasury authorization (SPEC.md section 8: the
 * treasury signs the funding transfer via its own auth entry).
 */
export async function createTask(
  config: EscrowConfig,
  id: Buffer,
  payer: string,
  amount: bigint,
  deadline: bigint,
): Promise<{ txHash: string }> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.create_task({ id, payer, amount, deadline });

  const treasuryKeypair = Keypair.fromSecret(config.treasurySecretKey);
  await tx.signAuthEntries({ signAuthEntry: treasuryKeypair, address: treasuryKeypair.publicKey() });

  const sent = await tx.signAndSend();
  throwIfErr(sent.result, messageToCode);
  return { txHash: requireTxHash(sent) };
}

/** Locked or Assigned to Assigned. Admin-authorized, reassign allowed before release. */
export async function assign(
  config: EscrowConfig,
  id: Buffer,
  worker: string,
): Promise<{ txHash: string }> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.assign({ id, worker });
  const sent = await tx.signAndSend();
  throwIfErr(sent.result, messageToCode);
  return { txHash: requireTxHash(sent) };
}

/** Assigned to Locked, when a claim expires. Admin-authorized. */
export async function unassign(config: EscrowConfig, id: Buffer): Promise<{ txHash: string }> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.unassign({ id });
  const sent = await tx.signAndSend();
  throwIfErr(sent.result, messageToCode);
  return { txHash: requireTxHash(sent) };
}

/** Assigned to Released; pays amount minus fee to the worker, fee to treasury. Admin-authorized. */
export async function release(config: EscrowConfig, id: Buffer): Promise<{ txHash: string }> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.release({ id });
  const sent = await tx.signAndSend();
  throwIfErr(sent.result, messageToCode);
  return { txHash: requireTxHash(sent) };
}

/**
 * Locked or Assigned to Refunded; pays amount back to the payer.
 * Anyone may call this after the deadline; only the admin may call it
 * before the deadline. The contract's require_auth enforces this: a
 * non-admin calling early fails with a host-level authorization error,
 * not an EscrowError (see docs/decisions.md, 2026-10-05).
 */
export async function refund(config: EscrowConfig, id: Buffer): Promise<{ txHash: string }> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.refund({ id });
  const sent = await tx.signAndSend();
  throwIfErr(sent.result, messageToCode);
  return { txHash: requireTxHash(sent) };
}

/** Read-only; no authorization required. */
export async function getTask(config: EscrowConfig, id: Buffer): Promise<Task> {
  const { client, messageToCode } = await getClient(config);
  const tx = await client.get_task({ id });
  return fromRawTask(throwIfErr(tx.result, messageToCode));
}

/** Rotates the admin key. Admin-authorized. */
export async function setAdmin(config: EscrowConfig, newAdmin: string): Promise<void> {
  const { client } = await getClient(config);
  const tx = await client.set_admin({ new: newAdmin });
  await tx.signAndSend();
}

export function escrowConfigFromEnv(): EscrowConfig {
  const contractId = requireEnv("ESCROW_CONTRACT_ID");
  const rpcUrl = requireEnv("STELLAR_RPC_URL");
  const adminSecretKey = requireEnv("ADMIN_SECRET_KEY");
  const treasurySecretKey = requireEnv("TREASURY_SECRET_KEY");

  return {
    contractId,
    rpcUrl,
    networkPassphrase: testnetPassphrase(),
    adminSecretKey,
    treasurySecretKey,
  };
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function testnetPassphrase(): string {
  const network = process.env.STELLAR_NETWORK;
  if (network !== "testnet") {
    throw new Error(`STELLAR_NETWORK must be "testnet", got ${JSON.stringify(network)}`);
  }
  return "Test SDF Network ; September 2015";
}
