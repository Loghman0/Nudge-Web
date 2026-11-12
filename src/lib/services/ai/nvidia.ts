import { createOpenAiCompatibleProvider } from "./openai-compatible";
import type { AiProvider, AiRequestOptions } from "./provider";
import { withAiDeadline } from "./deadline";
import { AiAccountingError } from "./attempt-meter";

export const NVIDIA_MODELS = {
  lightning: "nvidia/nemotron-3.5-lightning-30b-a3b",
  super: "nvidia/nemotron-3-super-120b-a12b",
  ultra: "nvidia/nemotron-3-ultra-550b-a55b",
  gpt_oss: "openai/gpt-oss-20b",
  gemma: "google/gemma-4-31b-it",
} as const;
export type NvidiaSlot = keyof typeof NVIDIA_MODELS;
const KEY_VARS: Record<NvidiaSlot, string> = { lightning: "NVIDIA_LIGHTNING_API_KEY", gemma: "NVIDIA_GEMMA_API_KEY", gpt_oss: "NVIDIA_GPT_OSS_API_KEY", super: "NVIDIA_SUPER_API_KEY", ultra: "NVIDIA_ULTRA_API_KEY" };
const AUTOMATIC_FALLBACKS: NvidiaSlot[] = ["lightning", "gemma", "gpt_oss"];
const ROLE_DEFAULTS = { parsing: "lightning", extraction: "gemma", reasoning: "gemma", summary: "gemma" } as const;
type NvidiaRole = keyof typeof ROLE_DEFAULTS;
const ROLE_VARS: Record<NvidiaRole, string> = { parsing: "NVIDIA_PARSING_MODEL", extraction: "NVIDIA_EXTRACTION_MODEL", reasoning: "NVIDIA_REASONING_MODEL", summary: "NVIDIA_SUMMARY_MODEL" };
const slotFor = (value: string): NvidiaSlot | undefined => (Object.keys(NVIDIA_MODELS) as NvidiaSlot[]).find(slot => slot === value || NVIDIA_MODELS[slot] === value);

/** Explicit allowlisting bounds routes before credentials or providers are used. */
export function readNvidiaRouting(env: Record<string, string | undefined>) {
  const raw = env.NVIDIA_ENABLED_MODELS === undefined ? "lightning,gemma" : env.NVIDIA_ENABLED_MODELS;
  const names = raw.split(",").map(name => name.trim());
  if (!names.length || names.some(name => !name || !slotFor(name))) return null;
  const enabled = [...new Set(names.map(name => slotFor(name)!))];
  const roles = { ...ROLE_DEFAULTS } as Record<NvidiaRole, NvidiaSlot>;
  for (const role of Object.keys(ROLE_DEFAULTS) as NvidiaRole[]) {
    const value = env[ROLE_VARS[role]]?.trim();
    if (!value) continue;
    const slot = slotFor(value);
    if (!slot || !enabled.includes(slot)) return null;
    roles[role] = slot;
  }
  return { enabled, roles };
}

/** Enabled current routes, with one bounded fallback and no implicit legacy model. */
export function createNvidiaProvider(env: Record<string, string | undefined> = process.env): AiProvider | null {
  const routing = readNvidiaRouting(env);
  if (!routing) return null;
  // A generic key can belong to another vendor. Do not forward it to NVIDIA
  // unless its prefix identifies it as a NVIDIA key.
  const generic = env.AI_API_KEY?.trim();
  const shared = env.NVIDIA_API_KEY?.trim() || (generic?.startsWith("nvapi-") ? generic : "");
  const providers = new Map<NvidiaSlot, AiProvider>();
  for (const slot of routing.enabled) {
    if ((slot === "super" || slot === "ultra") && !Object.values(routing.roles).includes(slot)) continue;
    const key = env[KEY_VARS[slot]]?.trim() || shared;
    if (!key) continue;
    providers.set(slot, createOpenAiCompatibleProvider({
      name: `nvidia:${slot}`, baseUrl: "https://integrate.api.nvidia.com/v1", apiKey: key,
      model: NVIDIA_MODELS[slot], timeoutMs: 8000, maxTokens: slot === "gpt_oss" ? 2048 : 1024,
      ...(["lightning", "super", "ultra"].includes(slot) ? { extraBody: { chat_template_kwargs: { enable_thinking: false } } } : {}),
    }));
  }
  if (!providers.size) return null;
  const { extraction, reasoning, parsing, summary } = routing.roles;
  async function run<T>(primary: NvidiaSlot, execute: (provider: AiProvider, options: AiRequestOptions) => Promise<T>, options?: AiRequestOptions): Promise<T> {
    const order = [...new Set<NvidiaSlot>([primary, ...AUTOMATIC_FALLBACKS])].filter(slot => providers.has(slot)).slice(0, 2);
    return withAiDeadline(async signal => {
      for (const slot of order) {
        signal.throwIfAborted();
        try { return await execute(providers.get(slot)!, { ...options, signal }); }
        catch (error) {
          if (error instanceof AiAccountingError) throw error;
          signal.throwIfAborted(); /* Never retry a canceled request. */
        }
      }
      throw new Error("NVIDIA AI is temporarily unavailable. Try again later.");
    }, 8000, options?.signal);
  }
  return { name: "nvidia",
    understandDecision: (text, options) => run(parsing, (p, request) => p.understandDecision(text, request), options),
    parseQuestion: (text, options) => run(parsing, (p, request) => p.parseQuestion(text, request), options),
    extractPreferences: (text, options) => run(extraction, (p, request) => p.extractPreferences(text, request), options),
    extractMemories: (text, options) => run(extraction, (p, request) => p.extractMemories(text, request), options),
    explainRecommendation: (input, options) => run(reasoning, (p, request) => p.explainRecommendation(input, request), options),
    summarizeMonth: (input, options) => run(summary, (p, request) => p.summarizeMonth(input, request), options),
  };
}
