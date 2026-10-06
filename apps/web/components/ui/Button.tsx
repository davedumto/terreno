"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "sun" | "forest" | "outline" | "ghost" | "lime";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonStyleProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  destructive?: boolean;
  iconOnly?: boolean;
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  sun: "bg-sun text-forest-ink hover:bg-forest-ink hover:text-sun",
  forest: "bg-forest-ink text-white hover:bg-mint hover:text-forest-ink",
  outline: "bg-transparent text-ink shadow-[inset_0_0_0_2px_var(--ink)] hover:bg-ink hover:text-bg",
  ghost: "bg-transparent text-white shadow-[inset_0_0_0_2px_white] hover:bg-white hover:text-ink",
  lime: "bg-lime text-forest-ink hover:bg-forest-ink hover:text-lime",
};

const DESTRUCTIVE_CLASSES =
  "bg-transparent text-coral shadow-[inset_0_0_0_2px_var(--color-coral)] hover:bg-coral hover:text-white";

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "px-[1.3em] py-[.75em] text-sm",
  md: "px-[1.6em] py-[.9em] text-[.9375rem]",
  lg: "px-[1.9em] py-[1em] text-[1.0625rem]",
};

const ICON_SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "size-9",
  md: "size-10",
  lg: "size-12",
};

// Exported separately from Button so pages styling a next/link `<Link>` as
// a button (navigation, not an action) can apply the identical visual
// treatment via Link's own className prop instead of duplicating classes.
export function buttonClasses({
  variant = "sun",
  size = "md",
  destructive = false,
  iconOnly = false,
  className = "",
}: ButtonStyleProps & { className?: string }): string {
  const variantClasses = destructive ? DESTRUCTIVE_CLASSES : VARIANT_CLASSES[variant];
  const sizeClasses = iconOnly ? ICON_SIZE_CLASSES[size] : SIZE_CLASSES[size];

  return `inline-flex items-center justify-center gap-[.6em] rounded-pill font-body font-bold transition-[background-color,color,translate] duration-200 ease-out active:translate-y-px disabled:opacity-45 disabled:cursor-not-allowed outline-none focus-visible:outline-2 focus-visible:outline-lime focus-visible:outline-offset-[3px] focus-visible:shadow-[0_0_0_3px_var(--ink)] ${variantClasses} ${sizeClasses} ${iconOnly ? "rounded-full p-0" : ""} ${className}`;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, destructive, iconOnly, className, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={buttonClasses({ variant, size, destructive, iconOnly, className })}
      {...props}
    />
  );
});
