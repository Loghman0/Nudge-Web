/**
 * Deterministic decision engine.
 *
 * Pipeline: user input → scoped preference data and history → deterministic scores and reasons.
 * The engine ranks candidate options with transparent, explainable scoring.
 * AI never picks the winner; it only explains the engine's ranking.
 */

import type { Decision, DecisionReflection, Preference } from "@/lib/types";
import { containsPreferenceTerm, isSameChoice, normalize } from "./similarity";

export interface Candidate {
  label: string;
  detail?: string;
  /** preference keys this candidate relates to, e.g. ['food.pizza', 'cuisine.italian'] */
  tags: string[];
}

export interface ScoredCandidate extends Candidate {
  score: number;
  breakdown: Record<string, number>;
}

/**
 * Extract the alternatives a person explicitly names.
 * Handles "pizza or sushi", "pizza vs sushi", and lists:
 * "sushi, pizza or ramen tonight?" → ["sushi", "pizza", "ramen"].
 */
export function extractNamedOptions(question: string): string[] {
  // Keep a supplied setting before the question and a goal after it out of
  // the alternatives. They remain in the original text for explicit review.
  const questionStart = question.search(/\b(?:should|would|can|could)\s+i\b/i);
  const sentence = (questionStart >= 0 ? question.slice(questionStart) : question)
    .split("?", 1)[0].replace(/[!.]+$/g, "");
  if (!/\s+(?:or|vs\.?|versus)\s+/i.test(sentence)) return [];
  const parts = sentence.replace(/^between\s+/i, "").split(/\s+(?:or|vs\.?|versus)\s+/i);

  const clean = (value: string, side: "left" | "right") => {
    let result = value.trim();
    if (side === "right") result = result.replace(/^(?:should|would|can|could)\s+i\s+/i, "");
    if (side === "left") {
      result = result.replace(/^(?:what|which)\s+(?:one|option)\s+(?:should|would)\s+i\s+/i, "");
      result = result.replace(/^(?:should|would|can|could)\s+i\s+(?:(?:get|have|eat|choose|pick|buy|watch|wear|do|go\s+(?:to|with))\s+)?/i, "");
    }
    if (side === "right") result = result.replace(/\s+(?:today|tonight|tomorrow|this\s+(?:weekend|week))$/i, "");
    return result.replace(/^the\s+/i, "").trim();
  };

  // The left side may itself be a comma-separated list of options.
  const leftParts = clean(parts[0], "left")
    .split(/\s*,\s*/)
    .map((part) => part.replace(/^and\s+/i, "").trim())
    .filter(Boolean);
  const options = [...leftParts, ...parts.slice(1).map((part) => clean(part, "right"))]
    .filter((option) => option.length > 0 && option.length < 100)
    .slice(0, 6);
  return [...new Map(options.map((option) => [option.toLowerCase(), option])).values()];
}

/**
 * Regret guard: true when the user's own past reflections on this exact
 * choice skew negative (regretted it, or rated it ≤ 2 stars).
 */
export function hasNegativeHistory(label: string, history: HistorySignal[]): boolean {
  return history.some(
    (h) =>
      h.selectedLabel != null &&
      isSameChoice(h.selectedLabel, label) &&
      (h.reflection?.has_regrets === true || (h.reflection?.rating != null && h.reflection.rating <= 2))
  );
}

/** Past decisions that mean the same choice as this candidate. */
export function relatedHistory(label: string, history: HistorySignal[]): HistorySignal[] {
  return history.filter((h) => h.selectedLabel != null && isSameChoice(h.selectedLabel, label));
}

/** Apply a preference only when an option itself contains the preference term. */
export function tagsForNamedOption(label: string, preferences: Preference[]): string[] {
  const normalized = normalize(label);
  return preferences
    .filter((preference) => {
      const value = normalize(preference.value ?? preference.key.split(".").pop() ?? "");
      if (value.length < 2) return false;
      return preference.polarity !== "neutral" && containsPreferenceTerm(normalized, value);
    })
    .map((preference) => preference.key);
}

interface HistorySignal {
  decision: Pick<Decision, "id" | "question" | "decided_at">;
  selectedLabel: string | null;
  reflection: DecisionReflection | null;
}

export interface EngineWeights {
  preferenceMatch: number; // how strongly explicit/inferred preferences match
  historySuccess: number;  // past satisfaction with similar choices
  novelty: number;         // gentle push toward variety
}

/**
 * Fallback weights only. Production ranking loads the active, versioned row
 * from `decision_engine_configs` (see engine-config.ts) so scoring is tunable
 * per category without a deploy — while staying fully deterministic.
 */
export const DEFAULT_WEIGHTS: EngineWeights = {
  preferenceMatch: 0.55,
  historySuccess: 0.3,
  novelty: 0.15,
};

/** Days since a timestamp, safe for nulls. */
function daysSince(iso: string | null | undefined, asOf: number): number {
  if (!iso) return Infinity;
  const timestamp = new Date(iso).getTime();
  return Number.isFinite(timestamp) ? Math.max(0, (asOf - timestamp) / 86_400_000) : Infinity;
}

function preferenceScore(candidate: Candidate, prefs: Preference[]): number {
  if (candidate.tags.length === 0) return 0.5;
  let total = 0;
  let matched = 0;
  for (const tag of candidate.tags) {
    const pref = prefs.find((p) => p.key === tag || tag.startsWith(p.key + "."));
    if (!pref) continue;
    if (pref.polarity === "neutral") continue;
    matched++;
    const signed = pref.polarity === "dislike" ? -pref.strength : pref.strength;
    // Confidence grows with evidence, capped.
    const confidence = Math.min(1, 0.5 + pref.evidence_count * 0.1);
    total += signed * confidence;
  }
  if (matched === 0) return 0.5; // unknown territory: neutral
  // Map [-1, 1] → [0, 1]
  return Math.max(0, Math.min(1, 0.5 + total / (2 * matched) ));
}

function historyScore(candidate: Candidate, history: HistorySignal[], asOf: number): number {
  // Similarity-weighted rather than exact-match: "sushi" and "that omakase
  // place" are the same decision as far as your memory is concerned.
  const related = history
    .filter((h) => h.selectedLabel != null && isSameChoice(h.selectedLabel, candidate.label));
  if (related.length === 0) return 0.5;

  let weighted = 0;
  let weightSum = 0;
  for (const h of related) {
    const recencyWeight = Math.exp(-daysSince(h.decision.decided_at, asOf) / 60);
    const rating = h.reflection?.rating ?? null;
    const base = h.reflection?.would_choose_again === false ? 0.1 :
      rating !== null ? (rating - 1) / 4 // 1..5 → 0..1
      : h.reflection?.would_repeat === true ? 0.8
      : h.reflection?.would_repeat === false ? 0.2
      : 0.55; // chosen but never reflected: mildly positive
    weighted += base * recencyWeight;
    weightSum += recencyWeight;
  }
  return weightSum === 0 ? 0.5 : weighted / weightSum;
}

function noveltyScore(candidate: Candidate, history: HistorySignal[], asOf: number): number {
  const lastPick = history.find(
    (h) => h.selectedLabel != null && isSameChoice(h.selectedLabel, candidate.label)
  );
  if (!lastPick) return 0.8; // never tried: encourage discovery
  const d = daysSince(lastPick.decision.decided_at, asOf);
  return Math.min(1, d / 14); // full novelty credit after 2 weeks
}

export function rankCandidates(
  candidates: Candidate[],
  prefs: Preference[],
  history: HistorySignal[],
  weights: EngineWeights = DEFAULT_WEIGHTS,
  asOf: number = Date.now()
): ScoredCandidate[] {
  return candidates
    .map((c) => {
      const breakdown = {
        preferenceMatch: preferenceScore(c, prefs),
        historySuccess: historyScore(c, history, asOf),
        novelty: noveltyScore(c, history, asOf),
      };
      const score =
        breakdown.preferenceMatch * weights.preferenceMatch +
        breakdown.historySuccess * weights.historySuccess +
        breakdown.novelty * weights.novelty;
      return { ...c, score, breakdown };
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * Reflection → preference reinforcement.
 * Returns strength deltas to apply to each tag of the chosen option.
 */
export function reinforcementDelta(reflection: DecisionReflection): number {
  const rating = reflection.rating ?? 3;
  let delta = (rating - 3) * 0.06; // 5★ → +0.12, 1★ → −0.12
  if (reflection.would_repeat === true) delta += 0.04;
  if (reflection.would_repeat === false) delta -= 0.06;
  if (reflection.has_regrets === true) delta -= 0.05;
  if (reflection.would_choose_again === false) delta = Math.min(delta, -0.1);
  return Math.max(-0.2, Math.min(0.2, delta));
}

export type { HistorySignal };

/**
 * Human-readable evidence for a score, built entirely from the user's own
 * data. This is what makes the product trustworthy: every point of the score
 * traces back to something they told Nudge or did before. AI is never needed
 * to produce these — it only ever rephrases them.
 */
export function reasonsFor(
  candidate: ScoredCandidate,
  prefs: Preference[],
  history: HistorySignal[],
  asOf: number = Date.now()
): string[] {
  const reasons: string[] = [];

  // 1) Matching preferences
  const matched = candidate.tags
    .map((tag) => prefs.find((p) => p.key === tag || tag.startsWith(p.key + ".")))
    .filter((p): p is Preference => Boolean(p) && p!.polarity !== "neutral")
    .sort((a, b) => b.strength - a.strength);

  for (const pref of matched.slice(0, 2)) {
    const label = (pref.value ?? pref.key.split(".").pop() ?? "").replace(/-/g, " ");
    if (pref.polarity === "dislike") reasons.push(`You've told Nudge you avoid ${label}`);
    else if (pref.strength >= 0.7) reasons.push(`Strong match with your taste for ${label}`);
    else reasons.push(`Matches your taste for ${label}`);
  }

  // 2) What happened last time
  const related = relatedHistory(candidate.label, history);
  const rated = related.filter((h) => h.reflection?.rating != null);
  if (rated.length > 0) {
    const avg = rated.reduce((sum, h) => sum + (h.reflection!.rating ?? 0), 0) / rated.length;
    const rounded = Math.round(avg * 10) / 10;
    if (avg >= 4) reasons.push(`You rated this ${rounded}/5 in the past`);
    else if (avg <= 2) reasons.push(`You only rated this ${rounded}/5 before`);
    else reasons.push(`Past rating: ${rounded}/5`);
  }

  const repeat = related.find((h) => h.reflection?.would_repeat != null);
  if (repeat) {
    reasons.push(repeat.reflection!.would_repeat ? "You said you'd do it again" : "You said you wouldn't repeat it");
  }

  // 3) Freshness
  if (related.length === 0) {
    reasons.push("No recorded outcome for this option in this setting yet");
  } else {
    const days = Math.round(daysSince(related[0].decision.decided_at, asOf));
    if (Number.isFinite(days)) {
      if (days <= 3) reasons.push(`You chose this ${days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`}`);
      else if (days >= 30) reasons.push(`It's been ${Math.round(days / 30)} month${days >= 60 ? "s" : ""} since last time`);
      else reasons.push(`Last chosen ${days} days ago`);
    }
    if (related.length >= 3) reasons.push(`Picked ${related.length} times before`);
  }

  if (reasons.length === 0) reasons.push("Nudge has nothing on this one yet — choosing it teaches it something");
  return reasons.slice(0, 4);
}

/** Confidence in the ranking: low when the top two are nearly tied. */
export function rankingConfidence(ranked: ScoredCandidate[]): "high" | "medium" | "low" {
  if (ranked.length < 2) return "low";
  const gap = ranked[0].score - ranked[1].score;
  if (gap >= 0.12) return "high";
  if (gap >= 0.04) return "medium";
  return "low";
}
