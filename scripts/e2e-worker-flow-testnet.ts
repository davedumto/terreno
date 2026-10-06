// Exercises the full agent-pays -> worker-claims -> worker-submits ->
// worker-gets-paid pipeline against the real running dev server and real
// testnet, using the treasury's own key as a stand-in payer (safe: this is
// the first real production worker's flow being verified, not a secret-
// touching operation, and the treasury already holds the test USDC float).
//
// Run with: pnpm exec tsx scripts/e2e-worker-flow-testnet.ts
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { PaymentRequired } from "@x402/core/types";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { createEd25519Signer } from "@x402/stellar";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const TREASURY_SECRET_KEY = process.env.TREASURY_SECRET_KEY!;
const SESSION_SECRET = process.env.SESSION_SECRET!;
const WORKER_ID = process.argv[2];
const WORKER_SESSION_TOKEN = process.argv[3];

if (!WORKER_ID || !WORKER_SESSION_TOKEN) {
  console.error("Usage: tsx scripts/e2e-worker-flow-testnet.ts <worker_id> <worker_session_token>");
  process.exit(1);
}

async function main() {
  console.log("Step 1: pay for a real verify_place task via x402...");

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
    task_token: string;
    status: string;
    payment_tx: string;
  };
  console.log("  task_id:", task.task_id, "| status:", task.status, "| payment_tx:", task.payment_tx);

  console.log("\nStep 2: claim the task as the real worker...");
  const claimRes = await fetch(`${APP_URL}/api/worker/tasks/${task.task_id}/claim`, {
    method: "POST",
    headers: { origin: APP_URL, cookie: `terreno_session=${WORKER_SESSION_TOKEN}` },
  });
  if (!claimRes.ok) {
    console.error("Claim failed:", claimRes.status, await claimRes.text());
    process.exit(1);
  }
  console.log("  claimed:", await claimRes.json());

  console.log("\nStep 3: submit an answer...");
  const submitRes = await fetch(`${APP_URL}/api/worker/tasks/${task.task_id}/submit`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: APP_URL, cookie: `terreno_session=${WORKER_SESSION_TOKEN}` },
    body: JSON.stringify({
      answer: { exists: "yes", open_now: "yes", notes: "e2e test submission" },
      photo_key: "e2e-test/stub.jpg",
    }),
  });
  if (!submitRes.ok) {
    console.error("Submit failed:", submitRes.status, await submitRes.text());
    process.exit(1);
  }
  const submitResult = await submitRes.json();
  console.log("  submit result:", submitResult);

  console.log("\nStep 4: poll the agent-facing GET endpoint for the final state...");
  const pollRes = await fetch(`${APP_URL}/api/tasks/${task.task_id}`, {
    headers: { authorization: `Bearer ${task.task_token}` },
  });
  console.log("  poll result:", await pollRes.json());

  console.log("\nAll steps completed. Check /me for the real worker's updated balance and earnings.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
