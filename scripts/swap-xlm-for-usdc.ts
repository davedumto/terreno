// One-off: swaps treasury's XLM for testnet USDC via Stellar's built-in DEX,
// using a self-payment path payment. SPEC.md section 9: "swap some XLM to
// testnet USDC (same recipe as the Vellar Playground)".
//
// Run with: pnpm exec tsx scripts/swap-xlm-for-usdc.ts

import { readFileSync } from "node:fs";
import { Asset, Keypair, Networks, Operation, TransactionBuilder, rpc } from "@stellar/stellar-sdk";

const USDC_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const USDC_ASSET = new Asset("USDC", USDC_ISSUER);

function loadEnvLocal(): Record<string, string> {
  const text = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const value = trimmed.slice(eq + 1);
    if (value) env[trimmed.slice(0, eq)] = value;
  }
  return env;
}

function requireEnv(env: Record<string, string>, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function main(): Promise<void> {
  const env = loadEnvLocal();
  const treasury = Keypair.fromSecret(requireEnv(env, "TREASURY_SECRET_KEY"));
  const server = new rpc.Server(requireEnv(env, "STELLAR_RPC_URL"));

  const sendAmount = "250"; // XLM
  const destMin = "15"; // USDC, conservative floor given ~9.26 XLM/USDC observed

  console.log(`Swapping ${sendAmount} XLM for at least ${destMin} USDC...`);

  const account = await server.getAccount(treasury.publicKey());
  const tx = new TransactionBuilder(account, {
    fee: "100000",
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(
      Operation.pathPaymentStrictSend({
        sendAsset: Asset.native(),
        sendAmount,
        destination: treasury.publicKey(),
        destAsset: USDC_ASSET,
        destMin,
      }),
    )
    .setTimeout(30)
    .build();
  tx.sign(treasury);

  const sendResult = await server.sendTransaction(tx);
  if (sendResult.status !== "PENDING") {
    throw new Error(`submission failed: ${sendResult.status}`);
  }
  console.log("tx hash:", sendResult.hash);

  let status = await server.getTransaction(sendResult.hash);
  while (status.status === "NOT_FOUND") {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    status = await server.getTransaction(sendResult.hash);
  }

  if (status.status !== "SUCCESS") {
    throw new Error(`swap failed: ${JSON.stringify(status)}`);
  }

  console.log("Swap succeeded.");
  console.log(`https://stellar.expert/explorer/testnet/tx/${sendResult.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
