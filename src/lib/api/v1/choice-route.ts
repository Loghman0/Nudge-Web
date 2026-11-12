import { API_VERSION, type ApiErrorCode, type DecisionChoiceResponse } from "./contracts";
import type { createApiAuthenticator } from "./auth";
import { chooseDecision, type DecisionChoiceErrorCode } from "@/lib/services/decision-choice";

const MAX_BODY_BYTES = 1024;
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const errorStatuses: Record<DecisionChoiceErrorCode, number> = {
  invalid_input: 400, not_found: 404, invalid_option: 400, conflict: 409, unavailable: 503,
};
interface Dependencies { authenticate: ReturnType<typeof createApiAuthenticator>; choose?: typeof chooseDecision }

export function createChoicePostHandler({ authenticate, choose = chooseDecision }: Dependencies) {
  return async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
      return failure("unsupported_media_type", "Send this choice as JSON.", 415);
    const length = request.headers.get("content-length");
    if (length !== null && /^\d+$/.test(length) && Number(length) > MAX_BODY_BYTES)
      return failure("payload_too_large", "That choice request is too large.", 413);
    let raw: unknown;
    try {
      const body = await readBoundedJson(request);
      if (body.tooLarge) return failure("payload_too_large", "That choice request is too large.", 413);
      raw = body.value;
    } catch {
      return failure("invalid_json", "That choice request is not valid JSON.", 400);
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).some(key => key !== "optionId"))
      return failure("invalid_input", "Send only the optionId for this decision.", 400);
    const { id } = await context.params;
    const result = await choose(identity.client, identity.userId, { decisionId: id, optionId: (raw as Record<string, unknown>).optionId });
    if (!result.ok) return failure(result.code, result.message, errorStatuses[result.code]);
    return reply({ apiVersion: API_VERSION, data: {
      decisionId: result.decisionId, selectedOptionId: result.selectedOptionId, status: result.status,
    } }, 200);
  };
}

function failure(code: ApiErrorCode, message: string, status: number) { return reply({ apiVersion: API_VERSION, error: { code, message } }, status); }
function reply(payload: DecisionChoiceResponse, status: number) { return Response.json(payload, { status, headers }); }
async function readBoundedJson(request: Request): Promise<{ tooLarge: true } | { tooLarge: false; value: unknown }> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BODY_BYTES) { await reader.cancel(); return { tooLarge: true }; }
      chunks.push(chunk.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return { tooLarge: false, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) };
}
