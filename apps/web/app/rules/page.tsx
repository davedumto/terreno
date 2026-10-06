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
      <h1 className="text-xl font-semibold text-neutral-900">Worker rules</h1>
      <ul className="mt-6 space-y-4">
        {RULES.map((rule) => (
          <li key={rule} className="flex gap-3 text-neutral-700">
            <span aria-hidden="true" className="text-neutral-400">
              •
            </span>
            <span>{rule}</span>
          </li>
        ))}
      </ul>
      <p className="mt-8 text-sm text-neutral-500">
        Earnings show in USDC with an approximate local value. Cash out is not available yet.
      </p>
    </main>
  );
}
