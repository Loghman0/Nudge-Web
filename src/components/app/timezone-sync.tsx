"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * Keeps profiles.timezone in sync with the browser's IANA timezone so streak
 * math (00008) runs on the user's calendar day, not the database server's.
 * Fire-and-forget; runs once per app-shell mount, only for signed-in users.
 */
export function TimezoneSync() {
  useEffect(() => {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!timezone) return;
    const supabase = createClient();
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) return;
      void supabase.rpc("set_timezone", { p_timezone: timezone });
    });
  }, []);
  return null;
}
