"use client";

import { forwardRef } from "react";
import type { TextareaHTMLAttributes } from "react";
import { FieldError, inputBorderClasses } from "./FieldError";

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string | null;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, error, className = "", id, ...props },
  ref,
) {
  const textareaId = id ?? label?.toLowerCase().replace(/\s+/g, "-");

  return (
    <div>
      {label && (
        <label
          htmlFor={textareaId}
          className="mb-1 block text-[.6875rem] font-bold uppercase tracking-[.14em] text-muted2"
        >
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        id={textareaId}
        className={`w-full rounded-md border bg-surface2 px-3 py-2 text-[15px] text-ink outline-none transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-lime focus-visible:outline-offset-[3px] focus-visible:shadow-[0_0_0_3px_var(--ink)] ${inputBorderClasses(
          !!error,
        )} ${className}`}
        {...props}
      />
      <FieldError error={error} />
    </div>
  );
});
