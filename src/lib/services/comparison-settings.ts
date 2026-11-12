import type { DecisionCategory } from "@/lib/types";
import { isDecisionCategory } from "./comparison-input";

export interface ComparisonAlias { term: string; meaning: string }
export interface SavedComparisonSetting {
  id: string;
  name: string;
  domain: string;
  category: DecisionCategory;
  goal: string;
  aliases: ComparisonAlias[];
  memory_generation: number;
  created_at: string;
  updated_at: string;
}
export interface ComparisonSettingsState {
  available: boolean;
  generation: number | null;
  settings: SavedComparisonSetting[];
}
export interface ComparisonSettingDraft {
  id: string | null;
  name: string;
  domain: string;
  category: DecisionCategory;
  goal: string;
  aliases: ComparisonAlias[];
  generation: number;
}
export interface ComparisonSettingsResponse {
  state?: ComparisonSettingsState;
  error?: string;
  stale?: boolean;
}
export const unavailableComparisonSettings: ComparisonSettingsState = { available: false, generation: null, settings: [] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const comparisonTermKey = (term: string) => term.trim().toLowerCase();
export const comparisonDomainKey = (domain: string) => domain.trim().replace(/\s+/gu, " ").toLowerCase();
export const comparisonOptionDetail = (details: Record<string, string>, label: string) => Object.hasOwn(details, label) && typeof details[label] === "string" ? details[label] : "";

/** A setting is a deliberate vocabulary entry, never a copy of a journal draft. */
export function parseComparisonSetting(raw: unknown): { value?: ComparisonSettingDraft; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Enter a named comparison setting." };
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !["id", "name", "domain", "category", "goal", "aliases", "generation"].includes(key))) {
    return { error: "Settings can contain only a name, setting, decision type, goal and explicitly entered meanings." };
  }
  if (input.id !== null && (typeof input.id !== "string" || !uuid.test(input.id))) return { error: "Choose a valid saved setting." };
  if (!Number.isSafeInteger(input.generation) || Number(input.generation) < 0) return { error: "Reload saved settings before saving." };
  for (const [key, limit] of [["name", 80], ["domain", 100], ["goal", 300]] as const) {
    if (typeof input[key] !== "string" || input[key].length > limit || (key !== "goal" && !input[key].trim())) {
      return { error: "Use a name up to 80 characters, a setting up to 100, and a goal up to 300." };
    }
  }
  if (!isDecisionCategory(input.category)) return { error: "Choose a decision type for this setting." };
  if (!Array.isArray(input.aliases) || input.aliases.length > 12) return { error: "Save at most 12 meanings per setting." };
  const aliases: ComparisonAlias[] = [];
  const keys = new Set<string>();
  for (const rawAlias of input.aliases) {
    if (!rawAlias || typeof rawAlias !== "object" || Array.isArray(rawAlias)) return { error: "Enter each term and its meaning." };
    const alias = rawAlias as Record<string, unknown>;
    if (Object.keys(alias).some(key => !["term", "meaning"].includes(key)) || typeof alias.term !== "string" || !alias.term.trim() || alias.term.length > 80 ||
        typeof alias.meaning !== "string" || !alias.meaning.trim() || alias.meaning.length > 500) return { error: "Each meaning needs a term up to 80 characters and your definition up to 500." };
    // SQL also rejects duplicate whitespace variants; no duplicate can shadow another definition.
    const key = comparisonTermKey(alias.term).replace(/\s+/gu, " ");
    if (keys.has(key)) return { error: "Use each term only once in a setting." };
    keys.add(key); aliases.push({ term: alias.term.trim(), meaning: alias.meaning.trim() });
  }
  return { value: { id: input.id as string | null, name: (input.name as string).trim(), domain: comparisonDomainKey(input.domain as string),
    category: input.category, goal: (input.goal as string).trim(), aliases, generation: Number(input.generation) } };
}

export function decodeComparisonSettingsState(raw: unknown): ComparisonSettingsState | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  if (!Number.isSafeInteger(data.generation) || Number(data.generation) < 0 || !Array.isArray(data.settings) || data.settings.length > 20) return null;
  const settings: SavedComparisonSetting[] = [];
  for (const entry of data.settings) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
    const row = entry as Record<string, unknown>;
    const parsed = parseComparisonSetting({ id: row.id, name: row.name, domain: row.domain, category: row.category, goal: row.goal,
      aliases: row.aliases, generation: row.memory_generation });
    if (!parsed.value || row.memory_generation !== data.generation || typeof row.created_at !== "string" || typeof row.updated_at !== "string") return null;
    const {generation,...definition}=parsed.value;
    settings.push({ ...definition, id: definition.id!, memory_generation: generation, created_at: row.created_at, updated_at: row.updated_at });
  }
  return { available: true, generation: Number(data.generation), settings };
}

/** Only a complete current label matches; substrings, synonyms and other domains never do. */
export function applyComparisonAliases(setting: SavedComparisonSetting, labels: string[], currentDetails: Record<string, string>) {
  const details = new Map(Object.entries(currentDetails));
  const applied = new Map<string,string>();
  const aliases = new Map(setting.aliases.map(alias => [comparisonTermKey(alias.term), alias.meaning]));
  for (const label of labels.map(value => value.trim()).filter(Boolean)) {
    const meaning = aliases.get(comparisonTermKey(label));
    if (meaning && !details.get(label)?.trim()) { details.set(label,meaning); applied.set(label,meaning); }
  }
  return { details:Object.fromEntries(details), applied:Object.fromEntries(applied) };
}

export function removeAppliedComparisonAliases(details: Record<string, string>, applied: Record<string, string>) {
  return Object.fromEntries(Object.entries(details).filter(([term, meaning]) => comparisonOptionDetail(applied,term) !== meaning));
}
