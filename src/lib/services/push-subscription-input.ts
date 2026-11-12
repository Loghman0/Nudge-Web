import { validPushEndpoint } from "./push-endpoint";

export function parsePushSubscription(value:unknown):{endpoint:string;p256dh:string;auth:string}|null {
  if (!value || typeof value!=="object" || Array.isArray(value)) return null;
  const {endpoint,p256dh,auth}=value as Record<string,unknown>;
  if (!validPushEndpoint(endpoint) || typeof p256dh!=="string" || typeof auth!=="string" ||
      !/^[A-Za-z0-9_-]{80,100}$/.test(p256dh) || !/^[A-Za-z0-9_-]{20,30}$/.test(auth)) return null;
  return {endpoint,p256dh,auth};
}
