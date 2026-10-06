"use client";

import { forwardRef } from "react";
import type { SelectHTMLAttributes } from "react";
import { FieldError, INPUT_BASE_CLASSES, inputBorderClasses } from "./FieldError";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string | null;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, error, className = "", id, children, ...props },
  ref,
) {
  const selectId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div>
      {label && (
        <label
          htmlFor={selectId}
          className="mb-1 block text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2"
        >
          {label}
        </label>
      )}
      <select
        ref={ref}
        id={selectId}
        className={`${INPUT_BASE_CLASSES} ${inputBorderClasses(!!error)} ${className}`}
        {...props}
      >
        {children}
      </select>
      <FieldError error={error} />
    </div>
  );
});
