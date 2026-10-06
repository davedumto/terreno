import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Rules | Terreno",
};

const RULES = [
  'Answer only what you can see or know yourself. "Can\'t tell" is a valid answer.',
  "Never enter private property, follow anyone, or photograph people's faces.",
  "Report any task that feels wrong. Reporting never hurts your score, and reports are reviewed.",
];

export default function RulesPage() {
  return (
    <main className="mx-auto max-w-md px-4 py-8">
      <p className="font-mono text-[.75rem] font-bold uppercase tracking-[.22em] text-muted2">
        Before you start
      </p>
      <h1 className="mt-1 font-display text-[1.75rem] font-extrabold tracking-[-0.01em] text-ink">
        Worker <em className="font-serif italic font-semibold tracking-[-0.02em] text-forest">rules.</em>
      </h1>
      <ul className="mt-6 space-y-4">
        {RULES.map((rule) => (
          <li key={rule} className="flex gap-3 text-ink">
            <span aria-hidden="true" className="text-muted2">
              •
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-muted">
        Earnings show in USDC with an approximate local value. Cash out is not available yet.
      </p>
    </main>
  );
}
