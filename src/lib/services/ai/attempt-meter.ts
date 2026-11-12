import type { AiAttemptDescriptor, AiAttemptResult, AiAttemptUsage, AiRequestOptions } from "./provider";

/** Accounting failures must stop provider fallback rather than evade its budget. */
export class AiAccountingError extends Error {
  constructor(message = "AI request accounting is unavailable") {
    super(message);
    this.name = "AiAccountingError";
  }
}

const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const tokens = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const unknownUsage = (): AiAttemptUsage => ({ inputTokens: null, outputTokens: null, totalTokens: null });

/** Keep absent/malformed usage unknown, including legitimate zero-token responses. */
export function readAiUsage(data: unknown, format: "openai" | "anthropic"): AiAttemptUsage {
  if (!object(data) || !object(data.usage)) return unknownUsage();
  const usage = data.usage;
  if (format === "anthropic") {
    const baseInputTokens = tokens(usage.input_tokens);
    const cacheCreation = usage.cache_creation_input_tokens === undefined ? 0 : tokens(usage.cache_creation_input_tokens);
    const cacheRead = usage.cache_read_input_tokens === undefined ? 0 : tokens(usage.cache_read_input_tokens);
    const inputTotal = baseInputTokens !== null && cacheCreation !== null && cacheRead !== null ? baseInputTokens + cacheCreation + cacheRead : null;
    const inputTokens = tokens(inputTotal);
    const outputTokens = tokens(usage.output_tokens);
    const total = inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;
    const costMayDiffer = cacheCreation !== 0 || cacheRead !== 0;
    return { inputTokens, outputTokens, totalTokens: tokens(total), ...(costMayDiffer ? { costMayDiffer: true } : {}) };
  }
  const inputTokens = tokens(usage.prompt_tokens), outputTokens = tokens(usage.completion_tokens), totalTokens = tokens(usage.total_tokens);
  const costMayDiffer = inputTokens !== null && outputTokens !== null && totalTokens !== null && inputTokens + outputTokens !== totalTokens;
  return { inputTokens, outputTokens, totalTokens, ...(costMayDiffer ? { costMayDiffer: true } : {}) };
}

/** Meter the wire attempt before any response content is validated by a language task. */
export async function meteredAiRequest(
  descriptor: AiAttemptDescriptor,
  options: AiRequestOptions | undefined,
  signal: AbortSignal,
  format: "openai" | "anthropic",
  send: () => Promise<Response>,
): Promise<unknown> {
  const attempt: AiAttemptDescriptor = { ...descriptor, provider: descriptor.provider.slice(0, 80), model: descriptor.model.slice(0, 200) };
  let attemptId: string | null = null;
  signal.throwIfAborted();
  if (options?.accounting) {
    try { attemptId = await options.accounting.reserve(attempt); }
    catch { throw new AiAccountingError(); }
    if (typeof attemptId !== "string" || !attemptId.trim()) throw new AiAccountingError("AI request budget is unavailable");
  }

  const result: AiAttemptResult = { ...attempt, status: "failed", httpStatus: null, usage: unknownUsage() };
  try {
    // Reservation can outlive cancellation; a granted slot is finalized without sending.
    signal.throwIfAborted();
    const response = await send();
    result.httpStatus = response.status;
    let data: unknown;
    try { data = await response.json(); }
    catch { throw new Error(response.ok ? "AI returned invalid response data" : `AI request failed: ${response.status}`); }
    result.usage = readAiUsage(data, format);
    if (!response.ok) throw new Error(`AI request failed: ${response.status}`);
    signal.throwIfAborted();
    result.status = "succeeded";
    return data;
  } catch (error) {
    result.status = signal.aborted ? "aborted" : "failed";
    throw error;
  } finally {
    if (attemptId !== null && options?.accounting) {
      try { await options.accounting.finish(attemptId, result); }
      catch { throw new AiAccountingError(); }
    }
  }
}
