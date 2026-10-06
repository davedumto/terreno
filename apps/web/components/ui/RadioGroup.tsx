"use client";

interface RadioGroupProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: T[];
  optionLabel?: (option: T) => string;
}

// Promoted from /work/[id]/page.tsx's page-local RadioField — same
// mutually-exclusive-pill-toggle logic, now generic enough to also serve
// the admin chart card's 24H/7D/30D segmented control (spec §4.2/§5.5).
export function RadioGroup<T extends string>({
  label,
  value,
  onChange,
  options,
  optionLabel = (option) => option,
}: RadioGroupProps<T>) {
  return (
    <div>
      <span className="mb-1 block text-sm text-muted">{label}</span>
      <div className="flex gap-2">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={value === option}
            onClick={() => onChange(option)}
            className={`rounded-md border px-3 py-1.5 text-sm transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-lime focus-visible:outline-offset-[3px] ${
              value === option ? "border-lime bg-lime/10 text-lime" : "border-line text-muted hover:text-ink"
            }`}
          >
            {optionLabel(option)}
          </button>
        ))}
      </div>
    </div>
  );
}
