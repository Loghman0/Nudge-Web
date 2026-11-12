/** Operator-supplied rates and limits. No provider price is inferred. */
export interface AiModelPrice {
  provider: string;
  model: string;
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  maxAttemptMicros: number;
  maxInputBytes: number;
  maxOutputTokens: number;
}
export interface AiAccountingConfig {
  userDailyMicros: number;
  globalDailyMicros: number;
  models: AiModelPrice[];
}
const MAX_MICROS = 1_000_000_000_000;
export function usdToMicros(value: unknown): number | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d{0,6})(\.\d{1,6})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const result = Number(whole) * 1_000_000 + Number(fraction.padEnd(6, "0"));
  return Number.isSafeInteger(result) && result <= MAX_MICROS ? result : null;
}
export function readAiAccountingConfig(env: Record<string, string | undefined> = process.env): AiAccountingConfig | null {
  const userDailyMicros = usdToMicros(env.NUDGE_AI_USER_DAILY_USD);
  const globalDailyMicros = usdToMicros(env.NUDGE_AI_GLOBAL_DAILY_USD);
  if (!userDailyMicros || !globalDailyMicros || userDailyMicros > globalDailyMicros) return null;
  let rows: unknown;
  try { rows = JSON.parse(env.NUDGE_AI_MODEL_PRICES_JSON ?? ""); } catch { return null; }
  if (!Array.isArray(rows) || !rows.length || rows.length > 32) return null;
  const models: AiModelPrice[] = [], identities = new Set<string>();
  for (const value of rows) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.provider !== "string" || !/^[a-z0-9:_-]{1,80}$/.test(row.provider)
      || typeof row.model !== "string" || !/^[a-zA-Z0-9/_.:-]{1,160}$/.test(row.model)) return null;
    const inputMicrosPerMillion = usdToMicros(row.inputUsdPerMillion), outputMicrosPerMillion = usdToMicros(row.outputUsdPerMillion);
    const maxAttemptMicros = usdToMicros(row.maxAttemptUsd);
    if (inputMicrosPerMillion === null || outputMicrosPerMillion === null || maxAttemptMicros === null || maxAttemptMicros < 1
      || maxAttemptMicros > userDailyMicros || !Number.isInteger(row.maxInputBytes) || Number(row.maxInputBytes) < 1 || Number(row.maxInputBytes) > 1_000_000
      || !Number.isInteger(row.maxOutputTokens) || Number(row.maxOutputTokens) < 1 || Number(row.maxOutputTokens) > 100_000) return null;
    const identity = `${row.provider}\n${row.model}`;
    if (identities.has(identity)) return null;
    identities.add(identity);
    const model = { provider: row.provider, model: row.model, inputMicrosPerMillion, outputMicrosPerMillion,
      maxAttemptMicros, maxInputBytes: Number(row.maxInputBytes), maxOutputTokens: Number(row.maxOutputTokens) };
    // Serialized UTF-8 bytes plus framing headroom is a conservative text-token
    // quote, not a provider tokenizer or a promise about invoice totals.
    const quote = ratedCostMicros(model.maxInputBytes + 1024, model.maxOutputTokens, model);
    if (quote === null || quote > maxAttemptMicros) return null;
    models.push(model);
  }
  return { userDailyMicros, globalDailyMicros, models };
}
/** Cost calculated from reported tokens and configured rates, not an invoice. */
export function ratedCostMicros(input: number, output: number, price: AiModelPrice): number | null {
  if (![input, output].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000_000)) return null;
  const numerator = BigInt(input) * BigInt(price.inputMicrosPerMillion) + BigInt(output) * BigInt(price.outputMicrosPerMillion);
  const roundedUp = (numerator + 999_999n) / 1_000_000n;
  return roundedUp <= BigInt(MAX_MICROS) ? Number(roundedUp) : null;
}
