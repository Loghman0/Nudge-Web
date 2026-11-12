import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createJournalGetHandler } from "@/lib/api/v1/journal-route";
import { createComparisonPostHandler } from "@/lib/api/v1/comparison-route";
export const dynamic = "force-dynamic";
export const GET = createJournalGetHandler(serverApiAuthenticator(true));
export const POST = createComparisonPostHandler({ authenticate: serverApiAuthenticator() });
