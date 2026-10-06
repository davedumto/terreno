"use client";

import type { ButtonHTMLAttributes } from "react";

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

export function Chip({ selected = false, className = "", ...props }: ChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={`rounded-pill border px-[12px] py-[5px] text-sm font-bold transition-colors duration-200 outline-none focus-visible:outline-2 focus-visible:outline-lime focus-visible:outline-offset-[3px] ${
        selected ? "border-transparent bg-mint-soft text-forest-ink" : "border-line text-muted hover:text-ink"
      } ${className}`}
      {...props}
    />
  );
}
