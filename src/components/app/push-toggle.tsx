"use client";

import { useEffect, useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { removePushSubscription, savePushSubscription } from "@/app/(app)/notifications/push-actions";

/** URL-safe base64 → Uint8Array, the format the Push API expects. */
function urlBase64ToUint8Array(base64: string): ArrayBuffer {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const buffer = new ArrayBuffer(raw.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i);
  return buffer;
}

export function PushToggle({ vapidPublicKey }: { vapidPublicKey: string | null }) {
  const [supported, setSupported] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ok = "serviceWorker" in navigator && "PushManager" in window;
    setSupported(ok);
    if (!ok) return;
    navigator.serviceWorker.ready
      .then((registration) => registration.pushManager.getSubscription())
      .then((subscription) => setEnabled(Boolean(subscription)))
      .catch(() => {});
  }, []);

  if (!supported) return null;

  if (!vapidPublicKey) {
    return (
      <p className="text-xs text-ink-faint">
        Push notifications are unavailable here. Your in-app check-ins still work.
      </p>
    );
  }

  async function enable() {
    setBusy(true); setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setMessage("Notifications are blocked in your browser settings.");
        return;
      }
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
      });
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      if (!json.endpoint || !json.keys) throw new Error("bad subscription");
      const result = await savePushSubscription({
        endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth,
      });
      if (result.ok) { setEnabled(true); setMessage("Check-ins will arrive on this device."); }
      else {await subscription.unsubscribe();setMessage("Couldn’t save the subscription. Notifications remain off.");}
    } catch {
      setMessage("Couldn't turn on notifications here.");
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true); setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        await removePushSubscription(subscription.endpoint);
        await subscription.unsubscribe();
      }
      setEnabled(false);
      setMessage("Turned off on this device.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        disabled={busy}
        onClick={enabled ? disable : enable}
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink disabled:opacity-50"
      >
        {enabled ? <BellOff size={15} /> : <Bell size={15} />}
        {busy ? "Working…" : enabled ? "Turn off reminders on this device" : "Remind me on this device"}
      </button>
      {message && <p className="mt-1.5 text-xs text-ink-faint">{message}</p>}
    </div>
  );
}
