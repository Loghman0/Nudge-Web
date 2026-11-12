import type { AiRequestOptions } from "./provider";
import { createLanguageTasks, decodeResponse } from "./language-tasks";
import { withAiDeadline } from "./deadline";
import { meteredAiRequest } from "./attempt-meter";

async function complete(system: string, user: string, options?: AiRequestOptions): Promise<string> {
  const key = process.env.ANTHROPIC_API_KEY ?? process.env.AI_API_KEY;
  if (!key) throw new Error("ANTHROPIC_API_KEY is not configured");
  return withAiDeadline(async signal => {
    const body = JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 600, system, messages: [{ role: "user", content: user }] });
    const data = await meteredAiRequest({ provider: "anthropic", model: "claude-sonnet-4-6", inputBytes: new TextEncoder().encode(body).byteLength, outputTokenLimit: 600 }, options, signal, "anthropic", () => fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body,
    }));
    const response = data as { content?: unknown } | null;
    if (!Array.isArray(response?.content)) throw new Error("AI returned no answer");
    return decodeResponse(response.content.filter((block: unknown): block is { type: string; text: string } =>
      !!block && typeof block === "object" && (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string").map((block: { text: string }) => block.text).join(""));
  }, 6000, options?.signal);
}
export const anthropicProvider = createLanguageTasks("anthropic", complete);
