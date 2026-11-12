import type { DecisionCategory } from "@/lib/types";
import { extractNamedOptions } from "./decision-engine";
import { guessDecisionCategory } from "./comparison-category";

/** Interpretation is a draft for the user to confirm, never a factual answer. */
export interface DecisionUnderstanding {
  options: string[];
  category: DecisionCategory;
  domain: string;
  goal: string;
  question: string;
  unfamiliarTerms: string[];
  source: "manual" | "ai";
  notice: string;
}

export interface DecisionMeaning {
  domain?: string;
  goal?: string;
  optionDetails?: Record<string, string>;
  meaningConfirmed?: boolean;
}

export function normalizeDomain(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function draftUnderstanding(text: string, options = extractNamedOptions(text)): DecisionUnderstanding {
  return {
    options: options.filter(option => option.length <= 80).slice(0, 8),
    category: guessDecisionCategory([text, ...options]),
    domain: "", goal: "", source: "manual", unfamiliarTerms: [],
    question: "What setting is this in, and what are you trying to achieve?",
    notice: "Confirm the setting and explain unfamiliar terms. Nudge has not verified facts about these options.",
  };
}

/** Models may extract alternatives, but cannot introduce options absent from the input. */
export function groundUnderstanding(draft: DecisionUnderstanding, text: string, namedOptions?: string[]): DecisionUnderstanding {
  const normalize = (value: string) => value.toLowerCase().replace(/\s+/gu, " ").trim();
  const supplied = normalize(text);
  // A substring inside another word is not a supplied term: car/camera and
  // Rust/trust must not become extracted alternatives or settings.
  const stated = (value: string) => {
    const needle = normalize(value);
    if (!needle) return false;
    const word = /[\p{L}\p{N}_]/u;
    let position = supplied.indexOf(needle);
    while (position !== -1) {
      const before = Array.from(supplied.slice(0, position)).at(-1) ?? "";
      const after = Array.from(supplied.slice(position + needle.length))[0] ?? "";
      if (!word.test(before) && !word.test(after)) return true;
      position = supplied.indexOf(needle, position + 1);
    }
    return false;
  };
  const grounded = draft.options.filter(stated);
  const options = namedOptions?.length ? namedOptions : grounded;
  const domain = stated(draft.domain) ? draft.domain : "";
  const goal = stated(draft.goal) ? draft.goal : "";
  // Generated questions can smuggle an unsupported factual premise even when
  // extracted fields are grounded. Keep clarification deterministic and neutral.
  const question = !domain && !goal ? "What setting is this in, and what are you trying to achieve?"
    : !domain ? "What setting is this choice in? Explain unfamiliar terms in your own words."
    : !goal ? "What are you trying to achieve? Explain unfamiliar terms in this setting."
    : "Check the setting, goal and what each option means before comparing.";
  return { ...draft, options: [...new Map(options.map(option => [normalize(option), option])).values()].slice(0, 8),
    domain, goal, question,
    unfamiliarTerms:draft.unfamiliarTerms.filter(stated),
    source: "ai", notice: "AI suggested this interpretation. Check and edit it before comparing; it is not verified factual advice." };
}

export function parseMeaning(raw: Record<string, unknown>, labels: string[]): { value?: DecisionMeaning; error?: string } {
  const value: DecisionMeaning = {};
  for (const field of ["domain", "goal"] as const) {
    if (raw[field] === undefined) continue;
    if (typeof raw[field] !== "string" || raw[field].length > (field === "domain" ? 100 : 300)) {
      return { error: "Keep the setting within 100 characters and the goal within 300." };
    }
    value[field] = field === "domain" ? normalizeDomain(raw[field]) : raw[field].trim();
  }
  if (raw.meaningConfirmed !== undefined && typeof raw.meaningConfirmed !== "boolean") return { error: "Confirm what these options mean before comparing." };
  if (raw.meaningConfirmed !== undefined) value.meaningConfirmed = raw.meaningConfirmed === true;
  if (raw.optionDetails !== undefined) {
    if (!raw.optionDetails || typeof raw.optionDetails !== "object" || Array.isArray(raw.optionDetails)) return { error: "Option details must belong to the options you entered." };
    const entries = Object.entries(raw.optionDetails);
    if (entries.length > 8 || entries.some(([label, detail]) => !labels.includes(label) || typeof detail !== "string" || detail.length > 500)) {
      return { error: "Use up to 500 characters of details for each current option." };
    }
    value.optionDetails = Object.fromEntries(entries.map(([label, detail]) => [label, (detail as string).trim()]));
  }
  return { value };
}
