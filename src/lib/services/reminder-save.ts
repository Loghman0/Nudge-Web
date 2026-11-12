import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { isRequestId } from "./comparison-input";

export interface ReminderInput { decisionId: string; enabled: boolean; dueAt: string | null }
export interface ReminderState { decisionId: string; enabled: boolean; dueAt: string | null; reminderVersion: number }
export type ReminderSaveErrorCode = "invalid_input" | "not_found" | "conflict" | "unavailable";
export type ReminderSaveResult = { ok: true; reminder: ReminderState }
  | { ok: false; code: ReminderSaveErrorCode; message: string };
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

/** A time must name an actual calendar date and explicit offset, never the server's local zone. */
function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length > 40) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!parts) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, offset] = parts;
  const [year, month, day, hour, minute, second] = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) return null;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4)) > 59)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseReminderInput(raw: unknown, now = Date.now()): { value?: ReminderInput; error?: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: "Choose a valid check-in time." };
  const input = raw as Record<string, unknown>;
  if (Object.keys(input).some(key => !["decisionId", "enabled", "dueAt"].includes(key))
    || !isRequestId(input.decisionId) || typeof input.enabled !== "boolean")
    return { error: "Choose a valid decision and check-in setting." };
  if (!input.enabled) {
    if (input.dueAt !== null) return { error: "Turning check-ins off requires dueAt to be null." };
    return { value: { decisionId: input.decisionId, enabled: false, dueAt: null } };
  }
  const due = timestamp(input.dueAt);
  if (due === null) return { error: "Choose a valid time with an explicit timezone offset." };
  if (due <= now || due > now + YEAR_MS) return { error: "Choose a future time within 365 days." };
  return { value: { decisionId: input.decisionId, enabled: true, dueAt: new Date(due).toISOString() } };
}

/** Each accepted RPC advances its reminder version; this is not an exactly-once retry contract. */
export async function saveReminder(db: SupabaseClient<Database>, verifiedUserId: string, raw: unknown): Promise<ReminderSaveResult> {
  const parsed = parseReminderInput(raw);
  if (!parsed.value) return { ok: false, code: "invalid_input", message: parsed.error! };
  const input = parsed.value;
  try {
    const current = await db.from("decisions").select("status, reminder_version")
      .eq("id", input.decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (current.error) return unavailable();
    if (!current.data) return { ok: false, code: "not_found", message: "That decision could not be found." };
    if (current.data.status !== "decided") return conflict();
    if (!Number.isSafeInteger(current.data.reminder_version) || current.data.reminder_version < 0) return unavailable();
    const { error } = await db.rpc("schedule_reflection", {
      p_decision_id: input.decisionId, p_due_at: input.dueAt, p_enabled: input.enabled,
    });
    if (error) {
      if (error.code === "P0001" && error.message === "Choose a future time within one year")
        return { ok: false, code: "invalid_input", message: "Choose a future time within 365 days." };
      if (error.code === "P0001" && error.message === "This decision is not waiting for reflection") return conflict();
      return unavailable();
    }
    const saved = await db.from("decisions").select("status, reminder_enabled, reflection_due_at, reminder_version")
      .eq("id", input.decisionId).eq("user_id", verifiedUserId).maybeSingle();
    if (saved.error || !saved.data) return unavailable();
    if (saved.data.status !== "decided") return conflict();
    if (!Number.isSafeInteger(saved.data.reminder_version) || saved.data.reminder_version <= current.data.reminder_version) return unavailable();
    const due = saved.data.reflection_due_at === null ? null : Date.parse(saved.data.reflection_due_at);
    if (saved.data.reminder_enabled !== input.enabled || due !== (input.dueAt === null ? null : Date.parse(input.dueAt))) return conflict();
    return { ok: true, reminder: { decisionId: input.decisionId, enabled: input.enabled, dueAt: input.dueAt, reminderVersion: saved.data.reminder_version } };
  } catch { return unavailable(); }
}

function conflict(): ReminderSaveResult { return { ok: false, code: "conflict", message: "This decision or check-in changed. Reload it before scheduling another check-in." }; }
function unavailable(): ReminderSaveResult { return { ok: false, code: "unavailable", message: "Couldn't confirm that check-in. Reload the decision before retrying in case it was saved." }; }
