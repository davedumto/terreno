# Terreno

Terreno lets any AI agent pay a real person, anywhere, to check, confirm or see
something in the physical world. Agents pay over x402 in USDC on Stellar
testnet. Payment is held in a Soroban escrow. A local worker is notified on
Telegram, answers from a mobile web app, and is paid on chain the moment they
submit. If nobody answers by the deadline, the agent is refunded automatically.

Built for the Stellar Passport "Find Your Way" hackathon.

Status: early scaffold (Phase 0). Architecture, trust model, known gaps and
test counts land here once the first full paid task runs end to end on
testnet (Phase 6).

## Repo layout

```
apps/
  web/          Next.js app: agent API, worker app, Telegram webhook
  sweeper/      background job loop (refunds, retries, reassigns)
packages/
  shared/       zod schemas, task types, constants
  mcp/          Terreno MCP server
contracts/
  escrow/       Soroban escrow contract (Rust)
scripts/        one-off and e2e scripts
docs/           decisions, proof of on-chain activity
```

## Running locally

```
pnpm install
pnpm build
pnpm test
```

See `.env.example` for required environment variables.

## License

Apache-2.0, see [LICENSE](LICENSE).
