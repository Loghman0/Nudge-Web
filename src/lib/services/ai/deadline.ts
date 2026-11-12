/** One abortable budget, including response decoding and fallback attempts. */
export async function withAiDeadline<T>(task: (signal: AbortSignal) => Promise<T>, milliseconds: number, parent?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const relay = () => controller.abort(parent?.reason);
  if (parent?.aborted) relay();
  else parent?.addEventListener("abort", relay, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("AI request timed out", "TimeoutError")), milliseconds);
  let rejectAbort: (() => void) | undefined;
  try {
    controller.signal.throwIfAborted();
    const aborted = new Promise<never>((_, reject) => {
      rejectAbort = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    return await Promise.race([task(controller.signal), aborted]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener("abort", relay);
    if (rejectAbort) controller.signal.removeEventListener("abort", rejectAbort);
    // Also cancel unfinished parallel work when its sibling fails.
    controller.abort();
  }
}
