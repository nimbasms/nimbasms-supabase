// POST /functions/v1/send-sms
//
// Sends one or many SMS messages through Nimba SMS and records each delivery
// attempt in `public.sms_logs`. Requires a valid Supabase JWT unless invoked
// with the service-role key.
//
// Body:
//   {
//     "to": "+224620000000" | ["+224620000000", "+224620000001"],
//     "message": "Hello",
//     "sender_name": "MyBrand"  // optional, falls back to NIMBA_DEFAULT_SENDER
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { corsHeaders, handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
  formatGuineanNumber,
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

  // ── Validate payload ────────────────────────────────────────────────────
  const recipientsRaw = body.to;
  const message = (body.message ?? "").trim();
  const senderName = body.sender_name?.trim() || undefined;

  if (!recipientsRaw) {
    return jsonResponse({ error: "`to` is required" }, { status: 400 });
  }
  if (!message) {
    return jsonResponse({ error: "`message` is required" }, { status: 400 });
  }
  const recipients = (Array.isArray(recipientsRaw) ? recipientsRaw : [recipientsRaw])
    .map((r) => formatGuineanNumber(String(r)))
    .filter(Boolean);
  if (recipients.length === 0) {
    return jsonResponse(
      { error: "No valid recipient phone numbers" },
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

  try {
    const result = await client.sendMessage({
      to: recipients,
      message,
      senderName,
    });
    const messageId = (result as { messageid?: string }).messageid ?? null;
    const sentAt = new Date().toISOString();

    // ── Log each recipient ───────────────────────────────────────────────
    const rows = recipients.map((recipient) => ({
      user_id: userId,
      recipient,
      message,
      sender_name: senderName ?? Deno.env.get("NIMBA_DEFAULT_SENDER") ?? null,
      // The Nimba API returns a single `messageid` for the batch; we store it
      // on the first recipient and leave it null for the others. A future
      // delivery report webhook will update by `messageid`+`contact`.
      message_id: messageId,
      status: "sent",
      sent_at: sentAt,
    }));
    // Only the first row keeps the message_id (it must be unique).
    for (let i = 1; i < rows.length; i++) rows[i].message_id = null;

    const { error: insertError } = await supabase.from("sms_logs").insert(rows);
    if (insertError) {
      console.error("sms_logs insert failed", insertError);
    }

    return jsonResponse({
      message_id: messageId,
      recipients,
      status: "sent",
      provider_response: result,
    });
  } catch (err) {
    const nimbaErr = err as NimbaSMSError;
    const status = nimbaErr.status && nimbaErr.status >= 400 ? nimbaErr.status : 502;
    // Best-effort: record the failure too so users can see it in the dashboard.
    await supabase.from("sms_logs").insert(
      recipients.map((recipient) => ({
        user_id: userId,
        recipient,
        message,
        sender_name: senderName ?? Deno.env.get("NIMBA_DEFAULT_SENDER") ?? null,
        status: "failed",
        error: nimbaErr.message,
      })),
    );
    return jsonResponse(
      { error: nimbaErr.message, code: nimbaErr.code ?? "send_failed" },
      { status, headers: corsHeaders },
    );
  }
});
