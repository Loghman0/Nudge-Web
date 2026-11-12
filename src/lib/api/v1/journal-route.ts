import { API_VERSION, type ApiErrorCode } from "./contracts";
import { createApiAuthenticator } from "./auth";
import { parseJournalQuery, readJournal, readJournalDecision } from "@/lib/services/journal-read";

type Authenticate = ReturnType<typeof createApiAuthenticator>;
const headers = { "Cache-Control": "private, no-store, max-age=0", "Pragma": "no-cache", "X-Content-Type-Options": "nosniff" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const failure = (code: ApiErrorCode, message: string, status: number) => reply({ apiVersion: API_VERSION, error: { code, message } }, status);
export function createJournalGetHandler(authenticate: Authenticate) {
  return async (request: Request): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    const query = parseJournalQuery(new URL(request.url).searchParams);
    if (!query) return failure("invalid_query", "Choose valid journal filters and pagination.", 400);
    try { return reply({ apiVersion: API_VERSION, data: await readJournal(identity.client, identity.userId, query) }); }
    catch { return failure("unavailable", "Couldn't load your journal. Please try again.", 503); }
  };
}
export function createJournalDecisionGetHandler(authenticate: Authenticate) {
  return async (request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> => {
    const identity = await authenticate(request);
    if (!identity.ok) return failure(identity.code, identity.message, identity.status);
    try {
      const result = await readJournalDecision(identity.client, identity.userId, (await context.params).id);
      if (result.invalid) return failure("invalid_input", "That decision identifier is invalid.", 400);
      if (!result.decision) return failure("not_found", "That decision could not be found.", 404);
      return reply({ apiVersion: API_VERSION, data: { decision: result.decision } });
    } catch { return failure("unavailable", "Couldn't load this decision. Please try again.", 503); }
  };
}
