"use client";

import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { FieldError, INPUT_BASE_CLASSES, inputBorderClasses } from "./FieldError";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string | null;
  mono?: boolean;
  pill?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, error, mono = false, pill = false, className = "", id, ...props },
  ref,
) {
  const inputId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div>
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1 block text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={`${INPUT_BASE_CLASSES} ${inputBorderClasses(!!error)} ${pill ? "rounded-pill" : ""} ${
          mono ? "font-mono" : ""
        } ${className}`}
        {...props}
      />
      <FieldError error={error} />
    </div>
  );
});
