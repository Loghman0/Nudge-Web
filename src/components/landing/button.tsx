"use client";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  asChild?: boolean;
  variant?: "primary" | "secondary" | "quiet" | "icon" | "segment" | "submit";
  status?: "idle" | "pending" | "success" | "error";
};
export const LandingButton = forwardRef<HTMLButtonElement, Props>(function LandingButton({ asChild, variant = "primary", status = "idle", className = "", disabled, ...props }, ref) {
  const Component = asChild ? Slot : "button";
  return <Component ref={ref} className={`lp-button lp-button-${variant} ${className}`} data-state={status} aria-busy={status === "pending" || undefined} disabled={disabled || status === "pending"} {...props} />;
});
