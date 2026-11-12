/**
 * Domain types shared by web (and, later, mobile).
 * Keep these UI-framework-free.
 */

export type DecisionCategory =
  | "food" | "entertainment" | "travel" | "shopping"
  | "lifestyle" | "work" | "social" | "health" | "career"
  | "relationships" | "finance" | "hobbies" | "other";

export type DecisionStatus = "open" | "decided" | "reflected" | "abandoned";
export type PreferencePolarity = "like" | "dislike" | "neutral";

export interface Profile {
  id: string;
  full_name: string | null;
  country: string | null;
  language: string | null;
  occupation: string | null;
  avatar_url: string | null;
  onboarded_at: string | null;
  decision_style: string | null;
}

export interface Preference {
  id: string;
  user_id: string;
  key: string;
  value: string | null;
  polarity: PreferencePolarity;
  strength: number;         // 0..1
  source: "explicit" | "inferred" | "reflected";
  evidence_count: number;
  category_slug?: string | null;
}

export interface KnowledgeNode {
  id: string;
  user_id: string;
  key: string;
  value: string | null;
  category_slug: string;
  polarity: PreferencePolarity;
  belief_score: number;
  confidence: number;
  evidence_count: number;
  source: string;
  last_reinforced_at: string;
  last_verified_at: string | null;
  verification_due_at: string | null;
}

export interface OnboardingQuestion {
  id: string;
  kind: "this_or_that" | "scale" | "free_text";
  prompt: string;
  option_a: string | null;
  option_b: string | null;
  maps_to_key_a: string | null;
  maps_to_key_b: string | null;
  sort_order: number;
}

export interface Decision {
  id: string;
  user_id: string;
  category: DecisionCategory;
  question: string;
  context: Record<string, unknown>;
  status: DecisionStatus;
  expected_outcome: string | null;
  selected_option_id: string | null;
  decided_at: string | null;
  created_at: string;
}

export interface DecisionOption {
  id: string;
  decision_id: string;
  label: string;
  detail: string | null;
  score: number | null;
  score_breakdown: Record<string, number>;
  rank: number | null;
  source: "engine" | "user" | "ai";
}

export interface DecisionReflection {
  decision_id: string;
  rating: number | null;         // 1..5
  would_repeat: boolean | null;
  has_regrets: boolean | null;
  would_recommend: boolean | null;
  /** Counterfactual: knowing the outcome, would you make the same decision again? */
  would_choose_again: boolean | null;
  notes: string | null;
}

export interface AiMemory {
  id: string;
  kind: "fact" | "goal" | "habit" | "constraint";
  content: string;
  confidence: number;
}
