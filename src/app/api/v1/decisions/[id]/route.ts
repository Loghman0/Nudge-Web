import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createJournalDecisionGetHandler } from "@/lib/api/v1/journal-route";
export const dynamic = "force-dynamic";
export const GET = createJournalDecisionGetHandler(serverApiAuthenticator(true));
