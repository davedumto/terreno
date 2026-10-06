type HealthStatus = "operational" | "degraded" | "down";

interface StatusHealthCardProps {
  status: HealthStatus;
  label: string;
}

const DOT_CLASSES: Record<HealthStatus, string> = {
  operational: "bg-signal animate-pulse shadow-[0_0_0_4px_color-mix(in_srgb,var(--signal)_20%,transparent)]",
  degraded: "bg-sun",
  down: "bg-coral",
};

const CARD_CLASSES: Record<HealthStatus, string> = {
  operational: "",
  degraded: "",
  down: "bg-coral-soft",
};

// Rendered as a static state, not polled: no facilitator health-check
// endpoint exists in this codebase to drive it live. A fabricated poll
// would be less honest than a stated-static default.
export function StatusHealthCard({ status, label }: StatusHealthCardProps) {
  return (
    <div className={`rounded-lg border border-line p-4 ${CARD_CLASSES[status]}`}>
      <p className="font-mono text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2">
        Facilitator
      </p>
      <div className="mt-1 flex items-center gap-2">
        <span className={`size-2 rounded-full ${DOT_CLASSES[status]}`} aria-hidden="true" />
        <span className="font-display text-base font-bold text-ink">{label}</span>
      </div>
    </div>
  );
}
