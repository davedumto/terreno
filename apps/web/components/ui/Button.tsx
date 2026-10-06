"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { buttonClasses, type ButtonStyleProps } from "./buttonStyles";

export type { ButtonVariant, ButtonSize } from "./buttonStyles";
export { buttonClasses };

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement>, ButtonStyleProps {}

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
