import { cn } from "@/lib/utils";
import { forwardRef, type InputHTMLAttributes } from "react";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "min-h-12 w-full rounded-xl border border-line bg-surface-raised px-4 py-2.5 text-base text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-hidden focus:ring-2 focus:ring-accent/20",
          className
        )}
        {...props}
      />
    );
  }
);
