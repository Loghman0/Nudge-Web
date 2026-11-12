/**
 * AI provider resolution — one place to swap vendors, driven by .env.
 *
 * Set AI_PROVIDER to: anthropic | groq | gemini | openrouter | mistral | openai | nvidia | custom
 * and put the matching key in AI_API_KEY (or the vendor-specific variable).
 * If AI_PROVIDER is unset, we use ANTHROPIC_API_KEY when present, otherwise the
 * first vendor key we find. With no key at all, `ai` is null and the app runs
 * on its deterministic fallbacks (heuristic parsing, no prose explanations).
 */

import { anthropicProvider } from "./anthropic";
import { createOpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider } from "./provider";
import { createNvidiaProvider } from "./nvidia";

interface Preset { baseUrl: string; model: string; keyVar: string }

const PRESETS: Record<string, Preset> = {
  groq:       { baseUrl: "https://api.groq.com/openai/v1",                          model: "llama-3.3-70b-versatile",                keyVar: "GROQ_API_KEY" },
  gemini:     { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.5-flash",                       keyVar: "GEMINI_API_KEY" },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1",                            model: "meta-llama/llama-3.3-70b-instruct:free", keyVar: "OPENROUTER_API_KEY" },
  mistral:    { baseUrl: "https://api.mistral.ai/v1",                               model: "mistral-small-latest",                   keyVar: "MISTRAL_API_KEY" },
  openai:     { baseUrl: "https://api.openai.com/v1",                               model: "gpt-4o-mini",                            keyVar: "OPENAI_API_KEY" },
};

function resolve(): AiProvider | null {
  const wanted = (process.env.AI_PROVIDER ?? "").toLowerCase().trim();
  if (wanted === "nvidia") return createNvidiaProvider();

  if (wanted === "anthropic") {
    return process.env.ANTHROPIC_API_KEY || process.env.AI_API_KEY ? anthropicProvider : null;
  }

  if (wanted === "custom") {
    const baseUrl = process.env.AI_BASE_URL;
    const model = process.env.AI_MODEL;
    const apiKey = process.env.AI_API_KEY ?? "unused"; // some local servers need none
    if (!baseUrl || !model) return null;
    return createOpenAiCompatibleProvider({ name: "custom", baseUrl, apiKey, model });
  }

  if (wanted && PRESETS[wanted]) {
    const preset = PRESETS[wanted];
    const apiKey = process.env.AI_API_KEY ?? process.env[preset.keyVar];
    if (!apiKey) return null;
    return createOpenAiCompatibleProvider({
      name: wanted,
      baseUrl: preset.baseUrl,
      apiKey,
      model: process.env.AI_MODEL ?? preset.model,
    });
  }

  // No explicit choice: auto-detect from whichever key exists.
  if (process.env.ANTHROPIC_API_KEY) return anthropicProvider;
  if (Object.keys(process.env).some(key => /^NVIDIA_.*API_KEY$/.test(key) && process.env[key])) return createNvidiaProvider();
  for (const [name, preset] of Object.entries(PRESETS)) {
    const apiKey = process.env[preset.keyVar];
    if (apiKey) {
      return createOpenAiCompatibleProvider({
        name,
        baseUrl: preset.baseUrl,
        apiKey,
        model: process.env.AI_MODEL ?? preset.model,
      });
    }
  }
  return null;
}

let cached: AiProvider | null | undefined;

/** The active AI provider, or null when no key is configured. */
export function getAi(): AiProvider | null {
  if (cached === undefined) cached = resolve();
  return cached;
}

export type { AiProvider, MonthlySummaryInput } from "./provider";
