import type { AiProvider, AiRequestOptions } from "./provider";
import { createLanguageTasks, decodeResponse } from "./language-tasks";
import { withAiDeadline } from "./deadline";
import { meteredAiRequest } from "./attempt-meter";

export interface OpenAiCompatibleConfig {
  name: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxTokens?: number;
  extraBody?: Record<string, unknown>;
}

export function createOpenAiCompatibleProvider(cfg: OpenAiCompatibleConfig): AiProvider {
  async function complete(system: string, user: string, options?: AiRequestOptions): Promise<string> {
    return withAiDeadline(async signal => {
      const outputTokenLimit = cfg.maxTokens ?? 600;
      // Provider extensions may not change the identity, number of completions,
      // or token limit used by the accounting reservation.
      const reservedFields = new Set(["model", "n", "max_tokens", "max_completion_tokens", "stream", "messages"]);
      const extraBody = Object.fromEntries(Object.entries(cfg.extraBody ?? {}).filter(([key]) => !reservedFields.has(key)));
      const body = JSON.stringify({ ...extraBody, model: cfg.model, max_tokens: outputTokenLimit,
        stream: false, temperature: 0.4, messages: [{ role: "system", content: system }, { role: "user", content: user }] });
      const data = await meteredAiRequest({ provider: cfg.name, model: cfg.model, inputBytes: new TextEncoder().encode(body).byteLength, outputTokenLimit }, options, signal, "openai", () => fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST", signal,
        headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
        body,
      }));
      const response = data as { choices?: { message?: { content?: unknown } }[] } | null;
      return decodeResponse(response?.choices?.[0]?.message?.content);
    }, cfg.timeoutMs ?? 6000, options?.signal);
  }
  return createLanguageTasks(cfg.name, complete);
}
