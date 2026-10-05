const SWEEP_INTERVAL_MS = Number(process.env.SWEEP_INTERVAL_MS ?? 30_000);

async function runSweep(): Promise<void> {
  // Jobs land in Phase 4 per SPEC.md section 16:
  // 1. paid tasks without escrow: retry create_task, or refund after 3 failures
  // 2. expired claims: unassign, reopen, re-notify
  // 3. open tasks with no claim after 10 minutes: notify the next 10, once
  // 4. past-deadline open/claimed tasks: refund
  // 5. submitted tasks without release: retry release
  // 6. pending callbacks: retry delivery
  // 7. facilitator keepalive
}

async function main(): Promise<void> {
  console.log(`sweeper started, interval ${SWEEP_INTERVAL_MS}ms`);
  for (;;) {
    try {
      await runSweep();
    } catch (err) {
      console.error("sweep iteration failed", err);
    }
    await new Promise((resolve) => setTimeout(resolve, SWEEP_INTERVAL_MS));
  }
}

main().catch((err) => {
  console.error("sweeper fatal error", err);
  process.exit(1);
});
