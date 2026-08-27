import webpush from "web-push";
import { getAllPushSubscriptions, deletePushSubscription } from "@/lib/server/db";

let configured = false;

function ensureVapidConfigured() {
  if (configured) return;
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) {
    throw new Error("VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY non impostate");
  }
  webpush.setVapidDetails("mailto:soldi-app@example.com", publicKey, privateKey);
  configured = true;
}

export async function sendPushToAll(payload: { title: string; body: string; url?: string; tag?: string }) {
  ensureVapidConfigured();

  const subs = await getAllPushSubscriptions();
  if (subs.length === 0) return { sent: 0, removed: 0 };

  const message = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url ?? "/",
    tag: payload.tag ?? "trading-signal",
  });

  const results = await Promise.allSettled(
    subs.map((s) => webpush.sendNotification(s.subscription, message))
  );

  let sent = 0;
  let removed = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === "fulfilled") {
      sent++;
    } else {
      const statusCode = (r.reason as any)?.statusCode;
      if (statusCode === 404 || statusCode === 410) {
        await deletePushSubscription(subs[i].endpoint);
        removed++;
      }
    }
  }

  return { sent, removed };
}
