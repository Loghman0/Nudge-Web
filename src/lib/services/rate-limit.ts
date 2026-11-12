/**
 * Rate limiting for AI-facing server actions.
 *
 * A per-user, per-action sliding window held in process memory. This is
 * deliberately simple: it caps the damage of a hammering client or a retry
 * loop against paid model APIs without adding a datastore round-trip to every
 * request.
 *
 * Honest scope: the window is per server instance. On a multi-instance
 * deployment the effective limit is (limit × instances) — still a hard ceiling
 * per user, which is the goal here. If exact global limits become necessary,
 * swap `check` for a Postgres/Redis-backed counter behind the same signature.
 */

interface Window {
  timestamps: number[];
  windowMs: number;
}

const windows = new Map<string, Window>();
let lastSweep = Date.now();

const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [key, entry] of windows) {
    entry.timestamps = entry.timestamps.filter((t) => now - t < entry.windowMs);
    if (entry.timestamps.length === 0) windows.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the oldest call leaves the window (only when blocked). */
  retryAfterSeconds: number;
}

/**
 * Record an attempt and report whether it is allowed.
 * `action` namespaces the window, e.g. "explain" or "recap".
 */
export function checkRateLimit(
  userId: string,
  action: string,
  limit: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  if (!Number.isInteger(limit) || limit < 1 || !Number.isFinite(windowMs) || windowMs <= 0) {
    return { allowed: false, retryAfterSeconds: 0 };
  }
  sweep(now);

  const key = `${userId}:${action}`;
  const entry = windows.get(key) ?? { timestamps: [], windowMs };
  entry.windowMs = windowMs;
  entry.timestamps = entry.timestamps.filter((t) => now - t < windowMs);

  if (entry.timestamps.length >= limit) {
    windows.set(key, entry);
    const oldest = entry.timestamps[0];
    return { allowed: false, retryAfterSeconds: Math.ceil((oldest + windowMs - now) / 1000) };
  }

  entry.timestamps.push(now);
  windows.set(key, entry);
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Sensible defaults for the product's AI surfaces. */
export const AI_LIMITS = {
  /** Optional question interpretation; manual clarification remains available. */
  interpret: { limit: 10, windowMs: 60 * 60 * 1000 },
  /** Post-result explanations: generous, they're cheap and user-triggered. */
  explain: { limit: 30, windowMs: 10 * 60 * 1000 },
  /** Monthly recap: expensive prompt, rarely needed twice. */
  recap: { limit: 5, windowMs: 60 * 60 * 1000 },
  /** Free-text extraction (onboarding "about me"). */
  extract: { limit: 10, windowMs: 60 * 60 * 1000 },
} as const;
