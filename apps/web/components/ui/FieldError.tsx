interface FieldErrorProps {
  error?: string | null;
}

// Shared error-row pattern (spec §5.4: "coral border plus a coral helper
// text line") — used by Input/Select/Textarea below, and reused directly
// wherever a standalone action (e.g. a submit button) needs the same
// visual error convention instead of inventing a second one.
export function FieldError({ error }: FieldErrorProps) {
  if (!error) return null;
  return <p className="mt-1 text-sm text-coral">{error}</p>;
}

export const INPUT_BASE_CLASSES =
  "h-11 w-full rounded-md border bg-surface2 px-3 text-[15px] text-ink outline-none transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-lime focus-visible:outline-offset-[3px] focus-visible:shadow-[0_0_0_3px_var(--ink)]";

export function inputBorderClasses(hasError: boolean): string {
  return hasError ? "border-coral" : "border-line";
}
