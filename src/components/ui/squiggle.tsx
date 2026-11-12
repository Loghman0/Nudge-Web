"use client";

/**
 * The Nudge signature: a hand-drawn underline that draws itself beneath a
 * word. Used under the key word of a heading — once per surface, so it stays
 * a signature and not a pattern. Inherits currentColor; pass a color class.
 */

import { motion, useReducedMotion } from "framer-motion";

export function Squiggle({
  children,
  className = "text-accent",
  delay = 0.6,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <span className="relative inline-block whitespace-nowrap">
      {children}
      <svg
        className={`absolute -bottom-[0.18em] left-0 h-[0.32em] w-full ${className}`}
        viewBox="0 0 120 12"
        fill="none"
        preserveAspectRatio="none"
        aria-hidden
      >
        <motion.path
          d="M2 8.5 C 14 3.5, 24 3.5, 36 8 S 58 11, 70 6.5 S 94 3, 118 7.5"
          stroke="currentColor"
          strokeWidth="3.2"
          strokeLinecap="round"
          initial={reduced ? { pathLength: 1 } : { pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: "-40px" }}
          transition={{ duration: 0.7, delay, ease: [0.65, 0, 0.35, 1] }}
        />
      </svg>
    </span>
  );
}

/** Slow-drifting ambient glow, for hero/dashboard backgrounds. */
export function GlowOrb({
  className,
  drift = 18,
  duration = 14,
}: {
  className?: string;
  drift?: number;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  if (reduced) return <div className={`glow-orb ${className ?? ""}`} aria-hidden />;
  return (
    <motion.div
      className={`glow-orb ${className ?? ""}`}
      aria-hidden
      animate={{ x: [0, drift, -drift * 0.6, 0], y: [0, -drift * 0.7, drift * 0.5, 0] }}
      transition={{ duration, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}
