// Pop-up (Web Push) notifications. A teammate opts in from the Team screen —
// nobody is ever subscribed automatically. Once on, their browser holds a
// "push subscription" (saved to Supabase) that the send-push Edge Function
// uses to wake their device with a real OS-level notification, even if
// Agency Command isn't open on screen. See supabase/functions/send-push.
import { sb } from "./supabaseClient.js";
import { store } from "./state.js";
import { VAPID_PUBLIC_KEY } from "./config.js";
import { toast } from "./utils.js";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) output[i] = rawData.charCodeAt(i);
  return output;
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function isPushEnabled() {
  if (!pushSupported()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return !!sub && Notification.permission === "granted";
  } catch {
    return false;
  }
}

export async function enablePush() {
  if (!pushSupported()) {
    toast("Notifications aren't supported on this browser/device", "error");
    return false;
  }
  if (!VAPID_PUBLIC_KEY) {
    toast("Notifications aren't finished setting up yet, ask the owner", "error");
    return false;
  }
  if (Notification.permission === "denied") {
    toast("Notifications are blocked, turn them on for this app in your browser/phone settings", "error");
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    toast("Notifications weren't enabled", "error");
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    const j = sub.toJSON();
    const { error } = await sb.from("push_subscriptions").upsert(
      { user_id: store.profile.id, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
      { onConflict: "endpoint" }
    );
    if (error) throw error;
    toast("Notifications turned on", "success");
    return true;
  } catch (err) {
    toast(err.message || "Couldn't turn on notifications", "error");
    return false;
  }
}

export async function disablePush() {
  if (!pushSupported()) return;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await sb.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    toast("Notifications turned off", "success");
  } catch (err) {
    toast(err.message || "Couldn't turn off notifications", "error");
  }
}

// Fire-and-forget: tells the send-push and send-email Edge Functions someone
// should be told. Never blocks or surfaces errors to the UI — a
// failed/unset-up notification should never get in the way of the actual
// add/assign action that triggered it.
export function notify(type, prospect_id, agent_id) {
  const body = { type, prospect_id, agent_id };
  sb.functions.invoke("send-push", { body }).catch((err) => {
    console.error("send-push invoke failed", err);
  });
  sb.functions.invoke("send-email", { body }).catch((err) => {
    console.error("send-email invoke failed", err);
  });
}
