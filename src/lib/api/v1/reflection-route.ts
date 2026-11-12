import { API_VERSION, type ApiErrorCode, type SaveReflectionResponse } from "./contracts";
import { createApiAuthenticator } from "./auth";
import { saveReflection, type ReflectionSaveErrorCode } from "@/lib/services/reflection-save";

const MAX_BODY_BYTES = 8192;
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const errorStatuses: Record<ReflectionSaveErrorCode, number> = {
  invalid_input: 400, not_found: 404, not_chosen: 409, conflict: 409, unavailable: 503,
};
interface Dependencies {
  authenticate: ReturnType<typeof createApiAuthenticator>;
  save?: typeof saveReflection;
}

export function createReflectionPostHandler({ authenticate, save = saveReflection }: Dependencies) {
  return async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    if (request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() !== "application/json")
      return failure("unsupported_media_type", "Send this reflection as JSON.", 415);
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && /^\d+$/.test(contentLength) && Number(contentLength) > MAX_BODY_BYTES)
      return failure("payload_too_large", "That reflection request is too large.", 413);
    let raw: unknown;
    try {
      const body = await readBoundedJson(request);
      if (body.tooLarge) return failure("payload_too_large", "That reflection request is too large.", 413);
      raw = body.value;
    } catch {
      return failure("invalid_json", "That reflection request is not valid JSON.", 400);
    }
    const { id } = await context.params;
    // Ignore decisionId/user_id supplied in JSON; only this resource path and
    // the verified session determine which owned record may change.
    const input = raw && typeof raw === "object" && !Array.isArray(raw) ? { ...raw, decisionId: id } : raw;
    const result = await save(identity.client, identity.userId, input);
    if (!result.ok) return failure(result.code, result.message, errorStatuses[result.code]);
    return reply({ apiVersion: API_VERSION, data: { decisionId: id, saved: result.saved } }, 200);
  };
}

function failure(code: ApiErrorCode, message: string, status: number) {
  return reply({ apiVersion: API_VERSION, error: { code, message } }, status);
}
function reply(payload: SaveReflectionResponse, status: number) {
  return Response.json(payload, { status, headers });
}
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
