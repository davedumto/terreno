import Link from "next/link";

export type KpiTint = "mint" | "sun" | "lime" | "forest";

interface KpiCardProps {
  label: string;
  value: string;
  deltaPct: number | null;
  href: string;
  goLabel: string;
  tint: KpiTint;
}

const TINT_CLASSES: Record<KpiTint, string> = {
  mint: "bg-mint-soft text-forest-ink",
  sun: "bg-sun-soft text-forest-ink",
  lime: "bg-lime-soft text-forest-ink",
  forest: "bg-forest-ink text-white",
};

const LABEL_CLASSES: Record<KpiTint, string> = {
  mint: "text-forest-ink/70",
  sun: "text-forest-ink/70",
  lime: "text-forest-ink/70",
  forest: "text-white/80",
};

export function KpiCard({ label, value, deltaPct, href, goLabel, tint }: KpiCardProps) {
  const up = deltaPct !== null && deltaPct >= 0;

  return (
    <Link
      href={href}
      className={`group flex flex-col gap-3 rounded-lg border border-line p-6 transition-all duration-150 hover:-translate-y-[3px] hover:shadow-[var(--sh-hover)] ${TINT_CLASSES[tint]}`}
    >
      <span className={`font-mono text-xs font-bold uppercase tracking-[.08em] ${LABEL_CLASSES[tint]}`}>
        {label}
      </span>
      <span className="font-display text-[clamp(2rem,1.6rem+1.4vw,3rem)] font-extrabold leading-none">
        {value}
      </span>
      {deltaPct !== null && (
        <span
          className={`text-[.8125rem] font-bold ${up ? (tint === "forest" ? "text-mint" : "text-forest") : "text-coral"}`}
        >
          {up ? "▲" : "▼"} {Math.abs(deltaPct).toFixed(1)}% vs prev
        </span>
      )}
      <span className="mt-auto flex -translate-x-1 items-center gap-1 font-mono text-xs font-semibold opacity-0 transition-all duration-150 group-hover:translate-x-0 group-hover:opacity-100">
        {goLabel} →
      </span>
    </Link>
  );
}
