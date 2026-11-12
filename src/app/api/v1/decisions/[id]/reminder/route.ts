import { serverApiAuthenticator } from "@/lib/api/v1/server-auth";
import { createReminderPostHandler } from "@/lib/api/v1/reminder-route";

export const dynamic = "force-dynamic";
export const POST = createReminderPostHandler({ authenticate: serverApiAuthenticator() });
