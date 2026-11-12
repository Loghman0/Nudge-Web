import { isRequestId } from "./comparison-input";

/** A rating is an explicit outcome; omitted follow-up answers stay unknown. */
export interface ReflectionInput {
  decisionId: string;
  rating: number;
  wouldRepeat?: boolean | null;
  hasRegrets?: boolean | null;
  wouldRecommend?: boolean | null;
  wouldChooseAgain?: boolean | null;
  notes?: string;
}

type Parsed = { value: Required<ReflectionInput>; error?: never } | { error: string; value?: never };

export function parseReflectionInput(input: unknown): Parsed {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { error: "That reflection is invalid." };
  const raw = input as Record<string, unknown>;
  if (!isRequestId(raw.decisionId)) return { error: "That decision could not be found." };
  if (typeof raw.rating !== "number" || !Number.isInteger(raw.rating) || raw.rating < 1 || raw.rating > 5)
    return { error: "Pick a rating between 1 and 5." };
  const value: Required<ReflectionInput> = {
    decisionId: raw.decisionId, rating: raw.rating,
    wouldRepeat: null, hasRegrets: null, wouldRecommend: null, wouldChooseAgain: null, notes: "",
  };
  for (const field of ["wouldRepeat", "hasRegrets", "wouldRecommend", "wouldChooseAgain"] as const) {
    if (raw[field] != null && typeof raw[field] !== "boolean") return { error: "Choose Yes, No, or leave optional answers blank." };
    value[field] = (raw[field] as boolean | null | undefined) ?? null;
  }
  if (raw.notes !== undefined && (typeof raw.notes !== "string" || raw.notes.length > 500))
    return { error: "Keep reflection notes within 500 characters." };
  value.notes = (raw.notes as string | undefined)?.trim() ?? "";
  return { value };
}
