import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import type { InputHTMLAttributes } from "react";

/** Label-above-input field. Never placeholder-as-label. */
export function Field({
  label,
  name,
  hint,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; hint?: string }) {
  const id = `field-${name}`;
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <Input id={id} name={name} {...props} />
      {hint && <p className="text-xs text-ink-muted">{hint}</p>}
    </div>
  );
}

/**
 * Wavy divider between stacked sections — the seam of the pressed-flower
 * scrapbook look. `fill` is the color of the section BELOW the wave.
 */
export function WaveDivider({ fill = "rgb(var(--surface))", flip = false }: { fill?: string; flip?: boolean }) {
  return (
    <svg
      className="wave-divider"
      viewBox="0 0 1440 44"
      preserveAspectRatio="none"
      style={flip ? { transform: "scaleY(-1)" } : undefined}
      aria-hidden
    >
      <path
        d="M0 24 C 120 8, 240 40, 360 26 S 600 6, 720 22 S 960 42, 1080 26 S 1320 8, 1440 24 L 1440 44 L 0 44 Z"
        fill={fill}
      />
    </svg>
  );
}

/**
 * The pressed flower — Nudge's hero illustration (an illustration, not an
 * icon glyph). Thin botanical line work matching the reference: a single
 * stem, paired leaves, and a geometric seed-head bloom.
 */
export function PressedFlower({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 200 300" fill="none" className={className} aria-hidden>
      <g stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
        {/* stem */}
        <path d="M100 288 C 100 220, 98 160, 100 84" />
        {/* leaf pairs */}
        <path d="M100 240 C 76 232, 58 236, 44 254 C 62 258, 84 252, 100 240 Z" />
        <path d="M100 205 C 122 195, 142 197, 158 182 C 140 176, 116 188, 100 205 Z" />
        <path d="M100 168 C 80 158, 62 158, 48 142 C 66 138, 88 150, 100 168 Z" />
        <path d="M100 132 C 120 122, 138 122, 154 108 C 136 102, 114 114, 100 132 Z" />
        {/* seed-head bloom: circle + petal lattice */}
        <circle cx="100" cy="56" r="26" />
        <path d="M100 30 L 100 82 M 74 56 L 126 56" />
        <path d="M82 38 L 118 74 M 118 38 L 82 74" />
        <path d="M100 30 C 112 42, 112 70, 100 82 C 88 70, 88 42, 100 30 Z" />
        <path d="M74 56 C 86 44, 114 44, 126 56 C 114 68, 86 68, 74 56 Z" />
      </g>
    </svg>
  );
}
