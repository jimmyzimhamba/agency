// ============================================================================
// STUDIO X COMMAND, WhatsApp (Twilio in-app conversation thread)
// ============================================================================
// The cold-open "Send WhatsApp" button (see buildWhatsAppLink in utils.js)
// stays a plain wa.me deep link, a human sending that first message from
// their own WhatsApp app is never subject to WhatsApp's 24-hour
// customer-service window. This module is only for what happens AFTER a
// prospect has replied at least once: a real in-app conversation thread,
// sent server-side via the send-whatsapp Edge Function (Twilio credentials
// never touch the browser).
// ============================================================================

import { sb } from "./supabaseClient.js";

// Mirrors the 24-hour check enforced authoritatively in
// supabase/functions/send-whatsapp/index.ts, this copy is just so the UI
// can decide up front whether to show the reply box or point back at the
// cold-open button, without waiting on a round-trip that's just going to
// say no anyway. The server is the one that actually enforces it.
export function canSendFreeform(prospect) {
  if (!prospect?.whatsapp_last_inbound_at) return false;
  const hoursSinceReply = (Date.now() - new Date(prospect.whatsapp_last_inbound_at).getTime()) / 3600000;
  return hoursSinceReply <= 24;
}

export async function sendWhatsAppMessage(prospectId, body) {
  return sb.functions.invoke("send-whatsapp", { body: { prospect_id: prospectId, body } });
}
