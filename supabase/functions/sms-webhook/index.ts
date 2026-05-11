// POST /functions/v1/sms-webhook
//
// Receives delivery reports from Nimba SMS and updates the matching row in
// `public.sms_logs`. The Nimba payload looks like:
//
//   { "messageid": "...", "contact": "224...", "status": "received"|"failed",
//     "error": "...", "metadata": { ... } }
//
// Because one `messageid` may map to several `sms_logs` rows (one per
// recipient in a batch send), we update the row matching BOTH `message_id`
// AND `contact`.
//
// Nimba does not document a built-in signature header, so we authenticate
// inbound requests with a shared secret you configure on both ends:
//
//   - Set `NIMBA_WEBHOOK_SECRET` in this function's environment.
//   - Configure your Nimba dashboard to call this URL with either:
//       * the header `x-nimba-signature: <secret>`  (preferred), or
//       * the query parameter `?secret=<secret>`    (fallback).
//
// `verify_jwt` is disabled for this function (see supabase/config.toml).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { formatGuineanNumber } from "../_shared/nimba-client.ts";
import type { NimbaWebhookPayload, SmsLogStatus } from "../_shared/types.ts";

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  // ── Authenticate the webhook ────────────────────────────────────────────
  const expected = Deno.env.get("NIMBA_WEBHOOK_SECRET");
  if (expected) {
    const headerSecret = req.headers.get("x-nimba-signature") ?? "";
    const url = new URL(req.url);
    const querySecret = url.searchParams.get("secret") ?? "";
    const provided = headerSecret || querySecret;
    if (!timingSafeEqual(provided, expected)) {
      return jsonResponse({ error: "Unauthorized" }, { status: 401 });
    }
  } else {
    console.warn(
      "NIMBA_WEBHOOK_SECRET is not set — inbound webhook requests are unauthenticated.",
    );
  }

  let payload: NimbaWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const messageId = payload.messageid;
  const contactRaw = payload.contact;
  const providerStatus = payload.status;
  if (!messageId || !contactRaw || !providerStatus) {
    return jsonResponse(
      { error: "Missing required fields (messageid, contact, status)" },
      { status: 400 },
    );
  }
  // Normalize to the same wire format we store (bare digits, e.g. `224...`).
  const contact = formatGuineanNumber(contactRaw);

  // ── Map Nimba's status vocabulary to ours ───────────────────────────────
  let mapped: SmsLogStatus;
  switch (providerStatus) {
    case "received":
      mapped = "delivered";
      break;
    case "failed":
    case "failure":
    case "no_credit":
    case "not_available":
      mapped = "failed";
      break;
    case "sent":
      mapped = "sent";
      break;
    default:
      mapped = "pending";
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  const update: Record<string, unknown> = {
    status: mapped,
    error: payload.error ?? null,
  };
  if (mapped === "delivered") update.delivered_at = new Date().toISOString();

  // Update the specific recipient row inside the batch.
  const { error, count } = await supabase
    .from("sms_logs")
    .update(update, { count: "exact" })
    .eq("message_id", messageId)
    .eq("recipient", contact);

  if (error) {
    console.error("sms_logs update failed", error);
    return jsonResponse({ error: "Database update failed" }, { status: 500 });
  }

  return jsonResponse({ ok: true, updated: count ?? 0 });
});

// Constant-time string comparison to avoid timing attacks on the shared secret.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
