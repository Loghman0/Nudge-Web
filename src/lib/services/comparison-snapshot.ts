import type { Preference } from "@/lib/types";
import type { CriteriaAssessment } from "./comparison-criteria";
import { hasNegativeHistory, reasonsFor, relatedHistory, type EngineWeights, type HistorySignal, type ScoredCandidate } from "./decision-engine";
import type { ResolvedEngineConfig } from "./engine-config";
import type {CriterionSource} from './criterion-provenance';

/** Persist only the rendered evidence used by this attempt, never source notes. */
export interface ComparisonEvidenceSnapshot {
  version: 1 | 2;
  criterionSources?: CriterionSource[];
  scoringRunId: string;
  scoredAt: string;
  basis: "journal" | "criteria";
  engineVersion: 2;
  engineConfig: { category: string; version: number; weights: EngineWeights };
  confidence: "high" | "medium" | "low";
  coldStart: boolean;
  evidenceState: "personal_fit" | "insufficient";
  options: {
    label: string;
    score: number;
    breakdown: Record<string, number>;
    reasons: string[];
    warning: boolean;
    sourceCounts: { preferences: number; decisions: number; reflections: number };
    sourceIds: { preferenceIds: string[]; decisionIds: string[] };
  }[];
}

export const SAVED_EVIDENCE_UNAVAILABLE = "Saved evidence is unavailable. Refresh this open comparison to use your current memory.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const integer = (value: unknown): value is number => finite(value) && Number.isSafeInteger(value) && value >= 0;
const text = (value: unknown, max: number): value is string => typeof value === "string" && value.length > 0 && value.length <= max;
const keys = (value: Record<string, unknown>, expected: string[]) => Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const timestamp = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 80 && value.every(id => typeof id === "string" && UUID.test(id)) && new Set(value).size === value.length;
const boundedIds = (values: string[]) => [...new Set(values.filter(id => UUID.test(id)))].slice(0, 80);
const boundedReasons = (values: string[]) => values.slice(0, 5).map(reason => reason.slice(0, 500));

export function buildComparisonSnapshot(input: {
  scoringRunId: string; asOf: number; config: ResolvedEngineConfig;
  ranked: ScoredCandidate[]; preferences: Preference[]; history: HistorySignal[];
  confidence: ComparisonEvidenceSnapshot["confidence"]; coldStart: boolean;
  evidenceState: ComparisonEvidenceSnapshot["evidenceState"];
  criteriaAssessment?: CriteriaAssessment | null;
  criterionSources?: CriterionSource[];
}): ComparisonEvidenceSnapshot {
  const { scoringRunId, asOf, config, ranked, preferences, history, confidence, coldStart, evidenceState, criteriaAssessment } = input;
  return {
    version: input.criterionSources?.length ? 2 : 1,...(input.criterionSources?.length?{criterionSources:input.criterionSources}:{}), scoringRunId, scoredAt: new Date(asOf).toISOString(), basis: criteriaAssessment ? "criteria" : "journal",
    engineVersion: 2, engineConfig: { category: config.configCategory, version: config.version, weights: { ...config.weights } },
    confidence, coldStart, evidenceState,
    options: ranked.map(candidate => {
      const related = criteriaAssessment ? [] : relatedHistory(candidate.label, history);
      const matched = criteriaAssessment ? [] : preferences.filter(preference => preference.polarity !== "neutral" && candidate.tags.some(tag => preference.key === tag || tag.startsWith(preference.key + ".")));
      const criteriaReasons = criteriaAssessment?.options.find(option => option.label === candidate.label)?.reasons;
      return {
        label: candidate.label, score: candidate.score, breakdown: { ...candidate.breakdown },
        reasons: boundedReasons(criteriaReasons ?? reasonsFor(candidate, preferences, history, asOf)),
        warning: !criteriaAssessment && hasNegativeHistory(candidate.label, history),
        sourceCounts: { preferences: matched.length, decisions: related.length, reflections: related.filter(signal => signal.reflection !== null).length },
        sourceIds: { preferenceIds: boundedIds(matched.map(preference => preference.id)), decisionIds: boundedIds(related.map(signal => signal.decision.id)) },
      };
    }),
  };
}

/** Reject unknown fields as well as malformed data so raw source notes cannot leak. */
export function parseComparisonSnapshot(raw: unknown): ComparisonEvidenceSnapshot | null {
  if (!object(raw) || !keys(raw, ["version", "scoringRunId", "scoredAt", "basis", "engineVersion", "engineConfig", "confidence", "coldStart", "evidenceState", "options",...(raw.version===2?['criterionSources']:[])])
    || (raw.version !== 1&&raw.version!==2) || typeof raw.scoringRunId !== "string" || !UUID.test(raw.scoringRunId) || !timestamp(raw.scoredAt)
    || !["journal", "criteria"].includes(raw.basis as string) || raw.engineVersion !== 2
    || !["high", "medium", "low"].includes(raw.confidence as string) || typeof raw.coldStart !== "boolean"
    || !["personal_fit", "insufficient"].includes(raw.evidenceState as string)
    || !object(raw.engineConfig) || !keys(raw.engineConfig, ["category", "version", "weights"])
    || !text(raw.engineConfig.category, 80) || !integer(raw.engineConfig.version)
    || !object(raw.engineConfig.weights) || !keys(raw.engineConfig.weights, ["preferenceMatch", "historySuccess", "novelty"])
    || !Object.values(raw.engineConfig.weights).every(weight => finite(weight) && weight >= 0 && weight <= 1)
    || !Array.isArray(raw.options) || raw.options.length < 2 || raw.options.length > 8) return null;
  if (Math.abs(Object.values(raw.engineConfig.weights).reduce<number>((total, weight) => total + (weight as number), 0) - 1) > 1e-9) return null;
  if(raw.version===2){
    if(raw.basis!=='criteria'||!Array.isArray(raw.criterionSources)||raw.criterionSources.length<1||raw.criterionSources.length>5)return null;
    const criterionIds=new Set<string>();
    for(const source of raw.criterionSources){
      if(!object(source)||!keys(source,['criterionId','suggestionId','generation','answers'])||!text(source.criterionId,50)||!/^[a-zA-Z0-9-]+$/.test(source.criterionId)||criterionIds.has(source.criterionId)||!text(source.suggestionId,512)||!integer(source.generation)||!Array.isArray(source.answers)||source.answers.length<1||source.answers.length>80)return null;
      criterionIds.add(source.criterionId);const answerIds=new Set<string>();
      for(const answer of source.answers){if(!object(answer)||!keys(answer,['answerId','answerRevision','questionId','questionVersion'])||typeof answer.answerId!=='string'||!UUID.test(answer.answerId)||answerIds.has(answer.answerId)||!integer(answer.answerRevision)||!text(answer.questionId,96)||!integer(answer.questionVersion)||answer.questionVersion<1)return null;answerIds.add(answer.answerId);}
    }
  }
  const labels = new Set<string>();
  for (const option of raw.options) {
    if (!object(option) || !keys(option, ["label", "score", "breakdown", "reasons", "warning", "sourceCounts", "sourceIds"])
      || !text(option.label, 80) || labels.has(option.label) || !finite(option.score) || option.score < 0 || option.score > 1
      || !object(option.breakdown) || !keys(option.breakdown, raw.basis === "criteria" ? ["criteriaLow", "criteriaHigh", "coverage"] : ["preferenceMatch", "historySuccess", "novelty"])
      || !Object.values(option.breakdown).every(value => finite(value) && value >= 0 && value <= 1)
      || !Array.isArray(option.reasons) || option.reasons.length < 1 || option.reasons.length > 5 || !option.reasons.every(reason => text(reason, 500))
      || typeof option.warning !== "boolean" || !object(option.sourceCounts) || !keys(option.sourceCounts, ["preferences", "decisions", "reflections"])
      || !integer(option.sourceCounts.preferences) || !integer(option.sourceCounts.decisions) || !integer(option.sourceCounts.reflections) || option.sourceCounts.reflections > option.sourceCounts.decisions
      || !object(option.sourceIds) || !keys(option.sourceIds, ["preferenceIds", "decisionIds"])
      || !ids(option.sourceIds.preferenceIds) || !ids(option.sourceIds.decisionIds)
      || option.sourceIds.preferenceIds.length > option.sourceCounts.preferences || option.sourceIds.decisionIds.length > option.sourceCounts.decisions) return null;
    if (raw.basis === "criteria" && (option.warning || Object.values(option.sourceCounts).some(count => count !== 0))) return null;
    labels.add(option.label);
  }
  try { if (JSON.stringify(raw).length > 131_072) return null; } catch { return null; }
  return raw as unknown as ComparisonEvidenceSnapshot;
}

interface SavedOption { label: string; score: number; breakdown: Record<string, number> }
interface SnapshotBinding {
  decisionId: string; revision: number; context: Record<string, unknown>; options: SavedOption[];
  criteriaAssessment?: CriteriaAssessment;
}
const sameNumbers = (left: unknown, right: unknown) => object(left) && object(right)
  && Object.keys(left).length === Object.keys(right).length
  && Object.keys(left).every(key => finite(left[key]) && left[key] === right[key]);

/** Only restore the revision that was atomically persisted with these exact scores. */
export function restoreComparisonSnapshot(rawRow: unknown, saved: SnapshotBinding): ComparisonEvidenceSnapshot | null {
  if (!object(rawRow) || rawRow.decision_id !== saved.decisionId || rawRow.comparison_revision !== saved.revision) return null;
  const snapshot = parseComparisonSnapshot(rawRow.snapshot);
  const context = saved.context;
  if (!snapshot || rawRow.scoring_run_id !== snapshot.scoringRunId || snapshot.scoringRunId !== context.scoring_run_id
    || snapshot.scoredAt !== context.scored_at || snapshot.engineVersion !== context.engine_version
    || snapshot.basis !== (context.comparisonBasis === "criteria" ? "criteria" : "journal")
    || snapshot.confidence !== context.confidence || snapshot.coldStart !== context.cold_start || snapshot.evidenceState !== context.evidence_state
    || !object(context.engine_config) || snapshot.engineConfig.category !== context.engine_config.category || snapshot.engineConfig.version !== context.engine_config.version
    || !sameNumbers(snapshot.engineConfig.weights, context.engine_config.weights) || snapshot.options.length !== saved.options.length) return null;
  if((context.discovery_criteria_used===true)!==!!snapshot.criterionSources?.length)return null;
  if(snapshot.criterionSources?.some(source=>!Array.isArray(context.criteria)||!context.criteria.some(c=>object(c)&&c.id===source.criterionId)))return null;
  for (const option of saved.options) {
    const evidence = snapshot.options.find(candidate => candidate.label === option.label);
    // PostgreSQL REAL rounds persisted option scores; metadata JSON retains doubles.
    if (!evidence || Math.fround(evidence.score) !== Math.fround(option.score) || !sameNumbers(evidence.breakdown, option.breakdown)) return null;
    if (snapshot.basis === "criteria") {
      const assessed = saved.criteriaAssessment?.options.find(candidate => candidate.label === option.label);
      if (!assessed || evidence.score !== assessed.low || !sameNumbers(evidence.breakdown, { criteriaLow: assessed.low, criteriaHigh: assessed.high, coverage: assessed.coverage })
        || JSON.stringify(evidence.reasons) !== JSON.stringify(boundedReasons(assessed.reasons))) return null;
    }
  }
  return snapshot;
}
