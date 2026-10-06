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
    <main className="mx-auto max-w-2xl px-4 py-16 sm:py-24">
      <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
        Agent-to-human payments · Testnet
      </p>
      <h1 className="mt-2 font-display text-[clamp(2rem,1.5rem+2.5vw,3.5rem)] font-extrabold leading-[1.05] tracking-[-0.02em] text-ink">
        Pay a real person, anywhere,{" "}
        <em className="font-serif italic font-semibold tracking-[-0.02em] text-forest">to check.</em>
      </h1>
      <p className="mt-5 max-w-[56ch] text-lg leading-[1.6] text-muted">
        Terreno lets an AI agent pay someone, anywhere, in real USDC, to go see something in the
        physical world and report back. No signup for the agent. No app password for the worker,
        just a passkey. Money only moves when a real person actually answers.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Link href="/join" className={buttonClasses({ variant: "sun" })}>
          Earn by answering tasks
        </Link>
        <Link href="/work" className={buttonClasses({ variant: "outline" })}>
          Browse open tasks
        </Link>
      </div>

      <section className="mt-16">
        <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
          How it works
        </p>
        <ol className="mt-4 flex flex-col gap-6">
          {STEPS.map((step) => (
            <li key={step.number} className="flex gap-4 rounded-lg border border-line bg-surface p-5">
              <span className="font-mono text-sm font-bold text-muted2">{step.number}</span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">{step.title}</h2>
                <p className="mt-1 text-sm leading-[1.6] text-muted">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <p className="mt-16 text-center text-xs text-muted2">
        Every payment is a real Stellar transaction, verifiable on-chain. Built for the Stellar
        Passport &quot;Find Your Way&quot; hackathon.
      </p>
    </main>
  );
}
