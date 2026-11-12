import { API_VERSION } from "./contracts";
import type { createApiAuthenticator } from "./auth";
import { isRequestId, parseComparisonInput } from "@/lib/services/comparison-input";
import { createComparison, refreshSavedComparison, type CompareResult, type ComparisonErrorCode } from "@/lib/services/comparison-service";

// Five criteria, eight options and bounded Unicode source notes/links can be
// larger than 32 KiB; preserve those existing limits while bounding actual bytes.
export const COMPARISON_CREATE_MAX_BYTES = 512 * 1024;
const REFRESH_MAX_BYTES = 1024;
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const statuses: Record<ComparisonErrorCode, number> = { invalid_input: 400, needs_confirmation: 400, forbidden: 403, conflict: 409, not_found: 404, unavailable: 503 };
type Authenticate = ReturnType<typeof createApiAuthenticator>;
interface Dependencies { authenticate: Authenticate; create?: typeof createComparison; refresh?: typeof refreshSavedComparison }
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const only = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).every(key => keys.includes(key));

/** Create only an explicitly confirmed comparison; interpretation is separate. */
export function createComparisonPostHandler({ authenticate, create = createComparison }: Dependencies) {
  return async (request: Request): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    const body = await readJson(request, COMPARISON_CREATE_MAX_BYTES);
    if (body.response) return body.response;
    const raw = body.value;
    if (!object(raw) || !only(raw, ["requestId", "options", "title", "context"]) || !isRequestId(raw.requestId)
      || (raw.title !== undefined && typeof raw.title !== "string") || !validContextShape(raw.context))
      return failure("invalid_input", "Send a stable requestId, options, title and confirmed context only.", 400);
    const parsed = parseComparisonInput(raw.options, raw.title ?? "", raw.context);
    if (!parsed.options) return failure("invalid_input", parsed.error, 400);
    if (!parsed.context.domain || parsed.context.meaningConfirmed !== true ||
        (parsed.context.comparisonBasis === "criteria" && parsed.context.criteriaConfirmed !== true))
      return failure("needs_confirmation", "Review and confirm the setting, option meanings and any criteria before saving.", 400);
    try {
      const result = await create(identity.client, identity.userId, parsed.options, parsed.title, parsed.context, raw.requestId);
      return resultResponse(result);
    } catch { return failure("unavailable", "Couldn't confirm the comparison. Retry the same requestId and unchanged inputs in case the save completed.", 503); }
  };
}

/** A stale revision cannot silently refresh a newer comparison. */
export function createComparisonRefreshPostHandler({ authenticate, refresh = refreshSavedComparison }: Dependencies) {
  return async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    const body = await readJson(request, REFRESH_MAX_BYTES);
    if (body.response) return body.response;
    const raw = body.value;
    if (!object(raw) || !only(raw, ["revision", "extraLabel"]) || !Number.isSafeInteger(raw.revision) || Number(raw.revision) < 0
      || (raw.extraLabel !== undefined && (typeof raw.extraLabel !== "string" || !raw.extraLabel.trim() || raw.extraLabel.length > 80)))
      return failure("invalid_input", "Send the saved revision and an optional distinct extraLabel of at most 80 characters.", 400);
    try {
      const { id } = await context.params;
      if (!isRequestId(id)) return failure("invalid_input", "That decision identifier is invalid.", 400);
      return resultResponse(await refresh(identity.client, identity.userId, id, raw.extraLabel as string | undefined, raw.revision as number));
    } catch { return failure("unavailable", "Couldn't confirm the refresh. Reload the comparison before retrying in case it completed.", 503); }
  };
}

function validContextShape(raw: unknown): raw is Record<string, unknown> {
  if (!object(raw) || !only(raw, ["appliedSetting", "mood", "budget", "company", "expectedOutcome", "category", "domain", "goal", "optionDetails", "meaningConfirmed", "comparisonBasis", "criteria", "criteriaConfirmed", "criteriaVersion"])) return false;
  if (raw.criteria !== undefined && (!Array.isArray(raw.criteria) || raw.criteria.some(criterion => !object(criterion)
    || !only(criterion, ["id", "label", "unit", "weight", "direction", "low", "high", "values", "discoverySuggestion"])
    || (criterion.discoverySuggestion !== undefined && (!object(criterion.discoverySuggestion) || !only(criterion.discoverySuggestion,["id","generation"]))) || !object(criterion.values)
    || Object.values(criterion.values).some(cell => !object(cell) || !only(cell, ["value", "sourceUrl", "note"]))))) return false;
  return true;
}
function resultResponse(result: CompareResult): Response {
  if (result.error) {
    const code = result.errorCode ?? (result.settingsInvalidated ? "conflict" : "unavailable");
    return failure(code, result.error, statuses[code]);
  }
  if (!isRequestId(result.decisionId) || result.clarification) return failure("unavailable", "The comparison save could not be confirmed.", 503);
  return reply({ apiVersion: API_VERSION, data: { comparison: result } });
}
const reply = (payload: unknown, status = 200) => Response.json(payload, { status, headers });
const failure = (code: string, message: string, status: number) => reply({ apiVersion: API_VERSION, error: { code, message } }, status);
async function readJson(request: Request, maximum: number): Promise<{ value?: unknown; response?: Response }> {
  if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
    return { response: failure("unsupported_media_type", "Send this comparison as JSON.", 415) };
  const length = request.headers.get("content-length");
  if (length !== null && /^\d+$/.test(length) && Number(length) > maximum)
    return { response: failure("payload_too_large", "That comparison request is too large.", 413) };
  try {
    const reader = request.body?.getReader();
    if (!reader) return { response: failure("invalid_json", "That comparison request is not valid JSON.", 400) };
    const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.byteLength;
        if (size > maximum) { await reader.cancel(); return { response: failure("payload_too_large", "That comparison request is too large.", 413) }; }
        parts.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
  } catch { return { response: failure("invalid_json", "That comparison request is not valid JSON.", 400) }; }
}
