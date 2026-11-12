"use client";

/**
 * Motion primitives for server-rendered pages.
 *
 * The dashboard stays a server component (zero data-fetch waterfalls); these
 * small client wrappers add life on top: staggered entrance, counters that
 * count up, progress bars that fill, and a gentle hover lift. All animations
 * respect the user's reduced-motion preference.
 */

import { LazyMotion, domAnimation, m, useInView, useReducedMotion } from "framer-motion";
import { useEffect, useRef, useState } from "react";

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>;
}

/** Fades + rises children in one after another. */
export function Stagger({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className={className}
      initial={reduced ? undefined : "hidden"}
      animate="show"
      variants={{
        hidden: {},
        show: { transition: { staggerChildren: 0.08, delayChildren: delay } },
      }}
    >
      {children}
    </m.div>
  );
}

/** One item inside a <Stagger>. Also lifts slightly on hover. */
export function StaggerItem({
  children,
  className,
  lift = true,
}: {
  children: React.ReactNode;
  className?: string;
  lift?: boolean;
}) {
  const reduced = useReducedMotion();
  return (
    <m.div
      className={className}
      variants={{
        hidden: { opacity: 0, y: 14 },
        show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 260, damping: 24 } },
      }}
      whileHover={reduced || !lift ? undefined : { y: -3, transition: { duration: 0.18 } }}
    >
      {children}
    </m.div>
  );
}

/** A number that counts up from 0 when it enters the viewport. */
export function CountUp({
  value,
  suffix = "",
  className,
  duration = 0.9,
}: {
  value: number;
  suffix?: string;
  className?: string;
  duration?: number;
}) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) { setDisplay(value); return; }
    if (!inView) return;
    let frame: number;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (duration * 1000));
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic
      setDisplay(Math.round(value * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [inView, value, duration, reduced]);

  return (
    <span ref={ref} className={className}>
      {display}{suffix}
    </span>
  );
}

/** A progress bar that fills to its width when it enters the viewport. */
export function ProgressFill({
  percent,
  className,
  barClassName,
}: {
  percent: number;
  className?: string;
  barClassName?: string;
}) {
  const reduced = useReducedMotion();
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={className}>
      <m.div
        className={barClassName}
        initial={reduced ? { width: `${clamped}%` } : { width: 0 }}
        animate={{ width: `${clamped}%` }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.25 }}
      />
    </div>
  );
}

/** A soft, slow pulse for accents (e.g. the streak flame). */
export function Pulse({ children, className }: { children: React.ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return <span className={className}>{children}</span>;
  return (
    <m.span
      className={className}
      animate={{ scale: [1, 1.12, 1] }}
      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
      style={{ display: "inline-flex" }}
    >
      {children}
    </m.span>
  );
}
