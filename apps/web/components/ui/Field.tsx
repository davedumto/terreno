interface FieldProps {
  label: string;
  value: React.ReactNode;
  badge?: React.ReactNode;
  sub?: React.ReactNode;
}

// The read-only labelled-value block (spec §4.4) — distinct from the
// focusable Input/Select/Textarea in this same directory. Used for
// displaying an amount, a fee, a network, etc., not for collecting one.
export function Field({ label, value, badge, sub }: FieldProps) {
  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-surface2 p-4">
      <span className="text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2">{label}</span>
      <div className="flex items-center gap-3">
        <span className="font-display text-[1.375rem] font-bold tracking-[-0.01em]">{value}</span>
        {badge}
      </div>
      {sub && <div className="flex items-center gap-3 text-sm text-muted2">{sub}</div>}
    </div>
  );
}
