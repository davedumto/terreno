import Link from "next/link";
import { buttonClasses } from "@/components/ui/buttonStyles";

const STEPS = [
  {
    number: "01",
    title: "An agent pays",
    body: "An AI agent needs to know something real, right now: is this shop open? What's this item actually priced at? It pays a few cents in USDC on Stellar, no signup, no invoice.",
  },
  {
    number: "02",
    title: "A real person checks",
    body: "The payment locks in an on-chain escrow. A local worker claims the task on their phone, goes and looks, answers with a real photo as proof.",
  },
  {
    number: "03",
    title: "Money moves on submit",
    body: "The worker gets paid the moment they submit, straight from escrow. The agent polls for the result and gets back a real answer with a real photo URL.",
  },
];

export default function HomePage() {
  return (
    <main className="bg-bg">
      <section className="relative overflow-hidden bg-forest-ink">
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -right-[8%] -top-[12%] select-none font-poster text-[42vw] leading-none text-white/[0.04] sm:text-[32vw]"
        >
          TERRENO
        </span>

        <div className="relative mx-auto max-w-5xl px-6 py-20 sm:px-10 sm:py-32">
          <p className="font-mono text-[.8125rem] font-bold uppercase tracking-[.28em] text-mint">
            Agent-to-human payments · Testnet
          </p>
          <h1 className="mt-5 max-w-4xl font-display text-[clamp(2.75rem,2rem+5vw,6rem)] font-extrabold leading-[0.98] tracking-[-0.03em] text-white">
            Pay a real person,
            <br />
            anywhere, <em className="font-serif italic font-semibold tracking-[-0.02em] text-lime">to check.</em>
          </h1>
          <p className="mt-8 max-w-[52ch] text-xl leading-[1.6] text-white/80">
            Terreno lets an AI agent pay someone, anywhere, in real USDC, to go see something in
            the physical world and report back. No signup for the agent. No app password for the
            worker, just a passkey. Money only moves when a real person actually answers.
          </p>

          <div className="mt-10 flex flex-wrap gap-4">
            <Link href="/join" className={buttonClasses({ variant: "sun", size: "lg" })}>
              Earn by answering tasks
            </Link>
            <Link href="/work" className={buttonClasses({ variant: "ghost", size: "lg" })}>
              Browse open tasks
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-5xl px-6 py-20 sm:px-10 sm:py-28">
        <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
          How it works
        </p>
        <ol className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {STEPS.map((step) => (
            <li key={step.number} className="rounded-lg border border-line bg-surface p-7">
              <span className="font-display text-4xl font-extrabold text-lime">{step.number}</span>
              <h2 className="mt-4 font-display text-xl font-bold text-ink">{step.title}</h2>
              <p className="mt-2 text-sm leading-[1.6] text-muted">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="border-t border-line bg-surface">
        <div className="mx-auto max-w-5xl px-6 py-12 text-center sm:px-10">
          <p className="text-sm text-muted2">
            Every payment is a real Stellar transaction, verifiable on-chain. Built for the
            Stellar Passport &quot;Find Your Way&quot; hackathon.
          </p>
        </div>
      </section>
    </main>
  );
}
