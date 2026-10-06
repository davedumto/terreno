# Proof

Testnet transactions produced by Terreno, newest first. Full end-to-end runs
(paid task to completed/refunded) land here starting Phase 2.

## Design system: real Cloudinary photo upload, verified live

2026-10-06: ran the full agent-pays to worker-answers-with-a-real-photo
pipeline against real testnet and the user's real Cloudinary account (task
`01M48YT6AEW4RBK8WEM1WTBDK6`). A real payment settled via `demo-agent-pays.ts`,
the worker claimed it, uploaded a real JPEG through the new
`POST /api/worker/tasks/[id]/photo` route, and submitted. The photo genuinely
landed on Cloudinary's CDN: `GET
https://res.cloudinary.com/dwjnkuvqv/image/upload/v1791302284/terreno/task-photos/01M48YT6AEW4RBK8WEM1WTBDK6.jpg`
returned `200`, `content-type: image/jpeg`, the exact uploaded bytes. The
task reached `completed` with a real on-chain release
(`97b0605bc66255debc4595c17dfad5100ad7b4850888d2cb2b4635abfb0995bb`).

One real bug surfaced and fixed along the way: an earlier test task
(`01M48TYX29Q8K83RDN8580CREY`) was left stuck `claimed` past its deadline,
with no code path to release it (SPEC.md section 16's sweeper job #2,
"expired claims," is not built yet). This blocked claiming a new task,
since one active claim per worker is enforced at the DB level. Fixed for
this session by calling the real `transition(db, task, "open")` directly
(the same `claimed -> open` edge the sweeper will eventually call
automatically), not a raw UPDATE; a real `claim_expired` task_events row
was logged. The underlying gap (no automatic claim-expiry sweep) remains
real and unfixed; this was a one-off manual unstick, not a fix to the
actual missing sweeper job.

## Phase 3: first real worker onboarded

2026-10-06: David ran `/join` for real, through a real browser (not a probe
script): a passkey registration, a second WebAuthn authentication ceremony
for the binding proof, the deploy carrier submitted and resourced through
`lib/worker-wallet.ts::submitWalletDeploy()` (the real-world confirmation
of the nonce/footprint fix below, not just the disposable-key probe that
found it), on-chain confirmation, and a genuine `workers` row created
(wallet `CDIXEKAEC736CT3OVBVM7HB4G2IJC2MCJEJVC5RMDGS32PI62MR2KVP4`). Landed
on `/work` successfully (empty, correctly, since no tasks exist yet). This
worker row is left in the database as real data, not cleaned up like the
earlier throwaway probe workers.

An earlier attempt in the same session failed during the registration
ceremony itself (browser console showed: `publicKey.pubKeyCredParams is
missing at least one of the default algorithm identifiers: ES256 and
RS256`, a warning from passkey-kit's own `startRegistration` call about its
WebAuthn options shape) but succeeded on retry; noted as a possible
intermittent authenticator-compatibility issue to watch for, not something
fixed in this project's own code.

## Phase 3: full agent-pays-to-worker-gets-paid pipeline, real worker

2026-10-06: `scripts/e2e-worker-flow-testnet.ts` (the treasury's own key
standing in as the x402 payer, a genuine worker's real session) ran the
complete pipeline against the real dev server and real testnet for the
first time: a real x402 payment settles
([`a578647a...e849bdda`](https://stellar.expert/explorer/testnet/tx/a578647a4877a8e181d34ea966f5e7c1d678c01477e48bfa270f90b0e849bdda)),
the server locks escrow
([`50a10eef...8c71e`](https://stellar.expert/explorer/testnet/tx/50a10eef42eb69ab16d41d8059cdd0d8d29e2b14323ad0b0a28c9cda3148c71e)),
David's real worker claims it, submits an answer, and release pays out
([`84ea5b56...02bb049`](https://stellar.expert/explorer/testnet/tx/84ea5b56b0e5096052890732e983072d5365b4fae9058ee66b8f6db2902bb049)).
`GET /api/tasks/{id}` (the agent-facing poll endpoint) correctly reports
`status: "completed"` with all three transaction hashes. `GET
/api/worker/me` confirmed the real on-chain effect: `balance.usdc: 0.45`
(the verified 10% fee correctly applied, not the `tasks.fee = 0` bug found
and fixed earlier this session), `completed_tasks: 1`, `score` recomputed
upward, a real earnings entry with the real release tx link.

A second, throwaway active worker in Enugu was temporarily inserted and
then deleted so the city satisfied SPEC.md section 12's live-city coverage
rule (at least 2 active workers) for this test; the no-coverage rejection
itself fired correctly on the first attempt before that worker existed,
confirming the coverage gate works as specified against real data, not
just in unit tests. Final database state verified clean afterward: David's
real worker and the one real completed task are the only rows left.

## Phase 3 regression check

`scripts/e2e-escrow-testnet.ts` rerun after downgrading `@stellar/stellar-sdk`
from `17.2.1` to `16.3.1` workspace-wide (passkey-kit compatibility; see
docs/decisions.md). Confirms `lib/escrow.ts` needed no code changes and still
works correctly end to end under the older SDK: `create_task` (task id
`eba086220885d2f941ec75061c326edabda5121bff946302c5ca7d48fa9ac845`, status
`Locked`), `assign` (status `Assigned`), `release` (status `Released`), a
second run's `create_task`/`refund` after the deadline passed (status
`Refunded`), and a `get_task` on an unknown id correctly raising `NotFound`.
Console output logged task ids and statuses, not individual tx hashes this
run; full script output: "All e2e checks passed."

## Phase 1

Escrow contract: `CCNSRMFSBNZ4YMCPMPB6CH3YU5QDJN23GHFZ52QNCFEF4VE64P44WSAK`
([Stellar Lab](https://lab.stellar.org/r/testnet/contract/CCNSRMFSBNZ4YMCPMPB6CH3YU5QDJN23GHFZ52QNCFEF4VE64P44WSAK))

- Deploy (upload wasm): [`4a4fabc4823b615a250368fa325f74dc3ebfc9f7674dd7c3f00a37bb1fe6a90c`](https://stellar.expert/explorer/testnet/tx/4a4fabc4823b615a250368fa325f74dc3ebfc9f7674dd7c3f00a37bb1fe6a90c)
- Deploy (create contract, first deploy, superseded): [`a10daf75442cfb66092be37e3f94c73505b6a4b7ec1dbc9a3b8cb82f1ba839ed`](https://stellar.expert/explorer/testnet/tx/a10daf75442cfb66092be37e3f94c73505b6a4b7ec1dbc9a3b8cb82f1ba839ed)
- Deploy (upload wasm, redeploy with error doc comments): [`72248d5a540d9a2656b042e2238467d967d21e54ab0fbca74a0821a6c2d31c3b`](https://stellar.expert/explorer/testnet/tx/72248d5a540d9a2656b042e2238467d967d21e54ab0fbca74a0821a6c2d31c3b)
- Deploy (create contract, current): [`d4edd4f3350db7a94da04179d153fe029a04cbab3f042703e9154820a5e8ba74`](https://stellar.expert/explorer/testnet/tx/d4edd4f3350db7a94da04179d153fe029a04cbab3f042703e9154820a5e8ba74)
- Treasury XLM -> USDC swap (acquiring testnet USDC, Circle faucet unavailable without a browser): [`65b19a9ed61a03fe923b7adbd0d4cbdc19377f0daa471725cc2705609e5e2f17`](https://stellar.expert/explorer/testnet/tx/65b19a9ed61a03fe923b7adbd0d4cbdc19377f0daa471725cc2705609e5e2f17)
- Treasury USDC -> XLM swap (bringing float back to the ~20 USDC limit in SPEC.md section 15): [`7eeb28a90b54adb28f2e40b2dd534cbca678efe69129f7d49753593813890098`](https://stellar.expert/explorer/testnet/tx/7eeb28a90b54adb28f2e40b2dd534cbca678efe69129f7d49753593813890098)

`cargo test`: 32 passed, 0 failed (every function, every reachable error, double release, double refund, refund before/after deadline, fee math rounding).

### scripts/e2e-escrow-testnet.ts run

Full run per SPEC.md section 2's Phase 1 check: `create_task`, `assign`,
`release` (run 1, ends completed); a second `create_task` with a near
deadline, then `refund` once it passes (run 2, ends refunded); plus a
`get_task` on an unknown id confirming `NotFound`. Transactions below
include the two Friendbot/trustline setup transactions for the test payer
and worker. Logged chronologically, oldest first:

- [`2b11ce7f440a1723fe7752f9ad31d3e305844802b84ea441c7ee1ed9c22b3177`](https://stellar.expert/explorer/testnet/tx/2b11ce7f440a1723fe7752f9ad31d3e305844802b84ea441c7ee1ed9c22b3177)
- [`df808710cab8188e02af836f3bbd6746c056b988c3c2bdf3d96849aa31e14a37`](https://stellar.expert/explorer/testnet/tx/df808710cab8188e02af836f3bbd6746c056b988c3c2bdf3d96849aa31e14a37)
- [`28e4c6e0942e036f7704082f839c8cd67a7061fe1df11514a639e333253f4fee`](https://stellar.expert/explorer/testnet/tx/28e4c6e0942e036f7704082f839c8cd67a7061fe1df11514a639e333253f4fee)
- [`dab3c11032a065c2844f0dc620860469094cd933e5aff8fed4ff4f3fd05d6c9e`](https://stellar.expert/explorer/testnet/tx/dab3c11032a065c2844f0dc620860469094cd933e5aff8fed4ff4f3fd05d6c9e)
- [`e48e14ad546eb77eab8ee32b8740f446e98d1b962ecda5799add630b993d38ab`](https://stellar.expert/explorer/testnet/tx/e48e14ad546eb77eab8ee32b8740f446e98d1b962ecda5799add630b993d38ab)
- [`1f051facecf3aecdc17d99f1c4c81dee13bddae20709a37ce17be7e6b6c4c24e`](https://stellar.expert/explorer/testnet/tx/1f051facecf3aecdc17d99f1c4c81dee13bddae20709a37ce17be7e6b6c4c24e)
- [`a51b7ef00660e5163e5110f5e5d4d0ee33dd5d2d127e38d0feb6c9a858efdccb`](https://stellar.expert/explorer/testnet/tx/a51b7ef00660e5163e5110f5e5d4d0ee33dd5d2d127e38d0feb6c9a858efdccb)
- [`e39a26925f6067fa86f5a696bf6696ce82e0be712577910ec3a152028b29f3bb`](https://stellar.expert/explorer/testnet/tx/e39a26925f6067fa86f5a696bf6696ce82e0be712577910ec3a152028b29f3bb)
- [`227eef8e5b380b5136aa179f9fcbe9e129720e3144c5b2e0fe498111133e75ad`](https://stellar.expert/explorer/testnet/tx/227eef8e5b380b5136aa179f9fcbe9e129720e3144c5b2e0fe498111133e75ad)

## Phase 0

- Treasury USDC trustline: [`251c4cd4f0dd43f464fe65eb30e269bbc61220a84cd46f33c690d02a0cdece30`](https://stellar.expert/explorer/testnet/tx/251c4cd4f0dd43f464fe65eb30e269bbc61220a84cd46f33c690d02a0cdece30)
