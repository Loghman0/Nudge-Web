import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createChoicePostHandler } from "@/lib/api/v1/choice-route";

export const dynamic = "force-dynamic";
export const POST = createChoicePostHandler({ authenticate: serverApiAuthenticator() });
