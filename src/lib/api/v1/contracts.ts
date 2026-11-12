import type { ReflectionInput } from "@/lib/services/reflection-input";
import type { ReflectionSaveErrorCode } from "@/lib/services/reflection-save";
import type { readJournal, readJournalDecision } from "@/lib/services/journal-read";
import type { DecisionChoiceErrorCode } from "@/lib/services/decision-choice";

export const API_VERSION = "1" as const;
/** POST /api/v1/decisions/:id/reflection. The path owns the decision identity. */
export type SaveReflectionRequest = Omit<ReflectionInput, "decisionId">;
export type ApiErrorCode = ReflectionSaveErrorCode | DecisionChoiceErrorCode | "unauthenticated" | "forbidden" | "needs_terms" | "invalid_query" | "invalid_json" | "unsupported_media_type" | "payload_too_large";
export type SaveReflectionResponse =
  | { apiVersion: typeof API_VERSION; data: { decisionId: string; saved: boolean } }
  | { apiVersion: typeof API_VERSION; error: { code: ApiErrorCode; message: string } };
type ApiFailure = { apiVersion: typeof API_VERSION; error: { code: ApiErrorCode; message: string } };
export interface DecisionChoiceRequest { optionId: string }
export type DecisionChoiceResponse = { apiVersion: typeof API_VERSION; data: { decisionId: string; selectedOptionId: string; status: "decided" | "reflected" } } | ApiFailure;
export type JournalResponse = { apiVersion: typeof API_VERSION; data: Awaited<ReturnType<typeof readJournal>> } | ApiFailure;
export type JournalDecisionResponse = { apiVersion: typeof API_VERSION; data: { decision: NonNullable<Awaited<ReturnType<typeof readJournalDecision>>["decision"]> } } | ApiFailure;
