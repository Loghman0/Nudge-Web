import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createComparisonRefreshPostHandler } from "@/lib/api/v1/comparison-route";

export const dynamic = "force-dynamic";
export const POST = createComparisonRefreshPostHandler({ authenticate: serverApiAuthenticator() });
