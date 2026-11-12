import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createAbandonPostHandler } from "@/lib/api/v1/abandon-route";

export const dynamic = "force-dynamic";
export const POST = createAbandonPostHandler({ authenticate: serverApiAuthenticator() });
