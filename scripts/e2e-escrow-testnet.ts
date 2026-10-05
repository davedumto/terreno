// Exercises the deployed escrow contract on testnet end to end:
// one run completes (create_task -> assign -> release), a second
// lets the deadline pass and refunds instead. Phase 1 check per
// SPEC.md section 2.
//
// Run with: pnpm exec tsx scripts/e2e-escrow-testnet.ts

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  rpc,
} from "@stellar/stellar-sdk";
import {
  assign,
  createTask,
  type EscrowConfig,
  EscrowError,
  getTask,
  refund,
  release,
} from "../apps/web/lib/escrow.js";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

async function fundAndAddTrustline(server: rpc.Server, keypair: Keypair): Promise<void> {
  const friendbotResponse = await fetch(
    `https://friendbot.stellar.org/?addr=${encodeURIComponent(keypair.publicKey())}`,
  );
  if (!friendbotResponse.ok) {
    throw new Error(`friendbot funding failed for ${keypair.publicKey()}: ${friendbotResponse.status}`);
  }

  const account = await server.getAccount(keypair.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "10000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.changeTrust({ asset: USDC_ASSET }))
    .setTimeout(30)
    .build();
  tx.sign(keypair);

  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status !== "PENDING") {
    throw new Error(`trustline submission failed for ${keypair.publicKey()}: ${sendResult.status}`);
  }

  let status = await server.getTransaction(sendResult.hash);
  while (status.status === "NOT_FOUND") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await server.getTransaction(sendResult.hash);
  }
  if (status.status !== "SUCCESS") {
    throw new Error(`trustline failed for ${keypair.publicKey()}: ${status.status}`);
  }
}

function loadEnvLocal(): void {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const value = trimmed.slice(eq + 1);
    if (value) process.env[key] = value;
  }
}

function taskIdFrom(seed: string): Buffer {
  return createHash("sha256").update(seed).digest();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  loadEnvLocal();

  const config: EscrowConfig = {
    contractId: requireEnv("ESCROW_CONTRACT_ID"),
    rpcUrl: requireEnv("STELLAR_RPC_URL"),
    networkPassphrase: "Test SDF Network ; September 2015",
    adminSecretKey: requireEnv("ADMIN_SECRET_KEY"),
    treasurySecretKey: requireEnv("TREASURY_SECRET_KEY"),
  };

  const server = new rpc.Server(config.rpcUrl);

  const payer = Keypair.random();
  const worker = Keypair.random();
  console.log("Funding and adding USDC trustlines for payer and worker...");
  await Promise.all([fundAndAddTrustline(server, payer), fundAndAddTrustline(server, worker)]);

  const amount = 5_000_000n; // 0.50 USDC in stroops

  // --- Run 1: completed ---
  const completedId = taskIdFrom(`e2e-completed-${randomBytes(8).toString("hex")}`);
  const completedDeadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

  console.log("Run 1 (completed): create_task...");
  await createTask(config, completedId, payer.publicKey(), amount, completedDeadline);
  console.log("  task id:", completedId.toString("hex"));

  let task = await getTask(config, completedId);
  console.log("  status after create_task:", task.status);

  console.log("Run 1: assign...");
  await assign(config, completedId, worker.publicKey());
  task = await getTask(config, completedId);
  console.log("  status after assign:", task.status, "worker:", task.worker);

  console.log("Run 1: release...");
  await release(config, completedId);
  task = await getTask(config, completedId);
  console.log("  status after release:", task.status);

  if (task.status !== "Released") {
    throw new Error(`expected Released, got ${task.status}`);
  }

  // --- Run 2: refunded ---
  // Deadline in the past; admin can refund immediately without waiting.
  const refundedId = taskIdFrom(`e2e-refunded-${randomBytes(8).toString("hex")}`);
  const nearDeadline = BigInt(Math.floor(Date.now() / 1000) + 30);

  console.log("Run 2 (refunded): create_task with a near deadline...");
  await createTask(config, refundedId, payer.publicKey(), amount, nearDeadline);

  console.log("Run 2: waiting for the deadline to pass...");
  await new Promise((resolve) => setTimeout(resolve, 35_000));

  console.log("Run 2: refund...");
  await refund(config, refundedId);
  task = await getTask(config, refundedId);
  console.log("  status after refund:", task.status);

  if (task.status !== "Refunded") {
    throw new Error(`expected Refunded, got ${task.status}`);
  }

  // --- Error path sanity check ---
  console.log("Sanity check: get_task on an unknown id...");
  try {
    await getTask(config, taskIdFrom("does-not-exist"));
    throw new Error("expected EscrowError, got no error");
  } catch (err) {
    if (!(err instanceof EscrowError)) throw err;
    console.log("  got EscrowError as expected:", err.code, err.message);
  }

  console.log("\nAll e2e checks passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
