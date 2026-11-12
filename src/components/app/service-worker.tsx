"use client";

import { useEffect } from "react";

/** Registers the PWA service worker once, after hydration. */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return; // avoid caching dev builds
    navigator.serviceWorker.register("/sw.js").catch(() => {
      /* registration is best-effort; the app works fine without it */
    });
  }, []);
  return null;
}
