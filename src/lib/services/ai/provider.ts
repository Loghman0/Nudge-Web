/**
 * AI provider abstraction.
 *
 * Rule: AI is NOT the recommendation engine. The deterministic
 * decision engine ranks options; AI is used only for language tasks:
 *  - parsing a free-text question into a structured DecisionQuery
 *  - extracting durable preferences/memories from text
 *  - explaining a recommendation the engine already made
 *
 * Swap providers by implementing this interface and changing
 * the export in ./index.ts. Nothing else in the app should import
 * a vendor SDK directly.
 */

import type { DecisionCategory } from "@/lib/types";
import type { DecisionUnderstanding } from "../decision-understanding";

export interface DecisionQuery {
  category: DecisionCategory;
  intent: string;                       // normalized question
  constraints: Record<string, string>;  // e.g. { budget: "low", time: "tonight" }
}

export interface ExtractedPreference {
  key: string;                          // 'cuisine.italian'
  polarity: "like" | "dislike";
  confidence: number;                   // 0..1
}

export interface ExtractedMemory {
  kind: "fact" | "goal" | "habit" | "constraint";
  content: string;                      // 'Vegetarian on weekdays'
  confidence: number;                   // 0..1
}

export interface RecommendationExplanationInput {
  setting?: string;
  question: string;
  chosenLabel: string;
  scoreBreakdown: Record<string, number>;
  topPreferences: string[];             // human-readable, e.g. 'likes Italian food'
}

export interface MonthlySummaryInput {
  windowDays: number;
  totalDecisions: number;
  topCategories: { category: string; count: number }[];
  bestRated: { question: string; chosen: string; rating: number }[];
  regretted: { question: string; chosen: string }[];
  averageRating: number | null;
  /** True when this is a bounded sample, not the entire window. */
  sampled?: boolean;
}

export interface AiAttemptDescriptor {
  /** Bounded transport identifiers only; never prompts or generated content. */
  provider: string;
  model: string;
  inputBytes: number;
  outputTokenLimit: number;
}

export interface AiAttemptUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  /** Additional pricing categories prevent a reliable plain input/output cost. */
  costMayDiffer?: boolean;
}

export interface AiAttemptResult extends AiAttemptDescriptor {
  status: "succeeded" | "failed" | "aborted";
  httpStatus: number | null;
  usage: AiAttemptUsage;
}

export interface AiAttemptAccounting {
  /** Return null to refuse this HTTP attempt before any provider request is sent. */
  reserve(attempt: AiAttemptDescriptor): Promise<string | null>;
  /** Must complete before another provider attempt can begin. */
  finish(attemptId: string, result: AiAttemptResult): Promise<void>;
}

export interface AiRequestOptions {
  signal?: AbortSignal;
  accounting?: AiAttemptAccounting;
}

export interface AiProvider {
  readonly name: string;
  understandDecision(text: string, options?: AiRequestOptions): Promise<DecisionUnderstanding>;
  parseQuestion(text: string, options?: AiRequestOptions): Promise<DecisionQuery>;
  extractPreferences(text: string, options?: AiRequestOptions): Promise<ExtractedPreference[]>;
  /** Structured goals/habits/constraints/facts for ai_memories. */
  extractMemories(text: string, options?: AiRequestOptions): Promise<ExtractedMemory[]>;
  explainRecommendation(input: RecommendationExplanationInput, options?: AiRequestOptions): Promise<string>;
  summarizeMonth(input: MonthlySummaryInput, options?: AiRequestOptions): Promise<string>;
}
