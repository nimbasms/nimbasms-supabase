// POST /functions/v1/send-sms
//
// Sends one Nimba SMS request and records every recipient in `public.sms_logs`.
// The Nimba REST API has a single sending endpoint (`POST /v1/messages`) that
// accepts `to` as an array of 1..50 numbers — there is no distinction between
// "single" and "batch". This function mirrors that contract.
//
// Body:
//   {
//     "to": ["224623000000", "224621000000"],
//     "sender_name": "MyBrand",
//     "message": "Hello"
//   }
//
// As a convenience, `to` may be a single string — it will be auto-wrapped
// into a 1-element array (the response sets `wrapped_single: true` so callers
// can detect the coercion).
//
// To send more than 50 recipients, split your list client-side and call this
// function multiple times.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
  formatGuineanNumber,
  MAX_RECIPIENTS_PER_REQUEST,
  NimbaSMSClient,
  NimbaSMSError,
} from "../_shared/nimba-client.ts";

interface SendSmsBody {
  to?: string | string[];
  message?: string;
  sender_name?: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: SendSmsBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  // ── Validate / coerce payload ───────────────────────────────────────────
  const message = (body.message ?? "").trim();
  const senderName = body.sender_name?.trim() || undefined;

  if (body.to === undefined || body.to === null) {
    return jsonResponse({ error: "`to` is required" }, { status: 400 });
  }
  if (!message) {
    return jsonResponse({ error: "`message` is required" }, { status: 400 });
  }

  const wrappedSingle = typeof body.to === "string";
  const rawList = wrappedSingle ? [body.to as string] : (body.to as string[]);
  if (!Array.isArray(rawList)) {
    return jsonResponse(
      { error: "`to` must be a string or an array of strings" },
      { status: 400 },
    );
  }

  const recipients = rawList
    .map((r) => formatGuineanNumber(String(r)))
    .filter(Boolean);
  if (recipients.length === 0) {
    return jsonResponse(
      { error: "No valid recipient phone numbers" },
      { status: 400 },
    );
  }
  if (recipients.length > MAX_RECIPIENTS_PER_REQUEST) {
    return jsonResponse(
      {
        error:
          `Nimba SMS accepts up to ${MAX_RECIPIENTS_PER_REQUEST} recipients per request; split your list and call this endpoint multiple times`,
        code: "too_many_recipients",
      },
      { status: 400 },
    );
  }

  // ── Identify caller (best-effort; verify_jwt=true rejects bad tokens) ───
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );
  let userId: string | null = null;
  const authHeader = req.headers.get("Authorization");
  if (authHeader) {
    const token = authHeader.replace(/^Bearer\s+/i, "");
    const { data } = await supabase.auth.getUser(token);
    userId = data.user?.id ?? null;
  }

  // ── Call Nimba SMS ──────────────────────────────────────────────────────
  let client: NimbaSMSClient;
  try {
    client = NimbaSMSClient.fromEnv();
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message, code: "configuration_error" },
      { status: 500 },
    );
  }

  const batchId = crypto.randomUUID();
  const senderForLog = senderName ?? Deno.env.get("NIMBA_DEFAULT_SENDER") ?? null;

  try {
    const result = await client.sendMessage({
      to: recipients,
      message,
      senderName,
    });
    const messageId = (result as { messageid?: string }).messageid ?? null;
    const sentAt = new Date().toISOString();

    // One row per recipient, all sharing the same message_id + batch_id.
    const rows = recipients.map((recipient) => ({
      user_id: userId,
      recipient,
      message,
      sender_name: senderForLog,
      message_id: messageId,
      batch_id: batchId,
      status: "sent" as const,
      sent_at: sentAt,
    }));

    const { error: insertError } = await supabase.from("sms_logs").insert(rows);
    if (insertError) {
      console.error("sms_logs insert failed", insertError);
    }

    return jsonResponse({
      message_id: messageId,
      batch_id: batchId,
      recipients,
      status: "sent",
      wrapped_single: wrappedSingle,
      provider_response: result,
    });
  } catch (err) {
    const nimbaErr = err as NimbaSMSError;
    const status = nimbaErr.status && nimbaErr.status >= 400 ? nimbaErr.status : 502;
    // Best-effort: persist failures too so the dashboard reflects them.
    await supabase.from("sms_logs").insert(
      recipients.map((recipient) => ({
        user_id: userId,
        recipient,
        message,
        sender_name: senderForLog,
        batch_id: batchId,
        status: "failed",
        error: nimbaErr.message,
      })),
    );
    return jsonResponse(
      { error: nimbaErr.message, code: nimbaErr.code ?? "send_failed", batch_id: batchId },
      { status, headers: corsHeaders },
    );
  }
});
