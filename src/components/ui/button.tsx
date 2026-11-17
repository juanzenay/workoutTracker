import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-accent text-accent-fg",
  secondary: "bg-surface-raised text-fg",
  outline: "border border-border-strong bg-transparent text-fg",
  ghost: "bg-transparent text-fg",
  danger: "bg-danger text-bg",
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant };

/** Classes for a link that looks like a <Button>. A min-h-* or px-* in `className` replaces the default. */
export function linkButtonClass(variant: ButtonVariant = "primary", className = "") {
  const height = /\bmin-h-/.test(className) ? "" : "min-h-touch";
  const padding = /\bpx-/.test(className) ? "" : "px-4";
  return `flex ${height} ${padding} items-center justify-center rounded-control font-medium ${VARIANTS[variant]} ${className}`;
}

/** Base button: always at least the minimum touch target. */
export function Button({ variant = "primary", className = "", ...props }: ButtonProps) {
  return (
    <button
      className={`min-h-touch rounded-control px-4 font-medium disabled:opacity-50 ${VARIANTS[variant]} ${className}`}
      {...props}
    />
  );
}
