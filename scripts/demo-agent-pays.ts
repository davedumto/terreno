// Demo-only script: pays for ONE real verify_place task via x402 and exits.
// Unlike e2e-worker-flow-testnet.ts (which also claims/submits as part of
// a regression test), this intentionally does nothing after payment, so a
// real worker can claim and answer it live, in the browser, during a demo.
//
// Run with: pnpm exec tsx scripts/demo-agent-pays.ts
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const TREASURY_SECRET_KEY = process.env.TREASURY_SECRET_KEY!;

async function main() {
  console.log("An AI agent needs to know: is this shop actually open right now?\n");
  console.log("Paying a real person via x402/USDC on Stellar to go check...\n");

  const signer = createEd25519Signer(TREASURY_SECRET_KEY, "stellar:testnet");
  const client = x402Client.fromConfig({
    schemes: [{ network: "stellar:testnet", client: new ExactStellarScheme(signer) }],
  });
  const httpClient = new x402HTTPClient(client);

  const body = JSON.stringify({
    location: { country: "NG", city: "enugu", address: "12 Ogui Road", lat: 6.44, lng: 7.5 },
    place_name: "Mama Nkechi Provisions",
    question: "Is the shop open right now and does it look like an active business?",
    deadline_minutes: 60,
  });

  const firstResponse = await fetch(`${APP_URL}/api/tasks/verify-place`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  const firstResult = await httpClient.processResponse(firstResponse);
  if (firstResult.paymentStatus !== "payment_required" || !firstResult.header) {
    console.error("Expected a 402 payment-required response, got:", firstResult);
    process.exit(1);
  }

  const paymentPayload = await httpClient.createPaymentPayload(firstResult.header as PaymentRequired);
  const paymentHeaders = httpClient.encodePaymentSignatureHeader(paymentPayload);

  const paidResponse = await fetch(`${APP_URL}/api/tasks/verify-place`, {
    method: "POST",
    headers: { "content-type": "application/json", ...paymentHeaders },
    body,
  });
  if (paidResponse.status !== 201) {
    console.error("Paid request did not return 201:", paidResponse.status, await paidResponse.text());
    process.exit(1);
  }
  const task = (await paidResponse.json()) as {
    task_id: string;
    status: string;
    payment_tx: string;
  };

  console.log("Paid.");
  console.log("  task_id:    ", task.task_id);
  console.log("  status:     ", task.status);
  console.log("  payment tx: ", task.payment_tx);
  console.log("\nA real worker in Enugu can now claim this at /work and get paid for answering it.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
