// POST /functions/v1/send-campaign
//
// Broadcasts a single message to a large recipient list. The Nimba SMS REST
// API caps a single /messages call at 50 recipients, so this function chunks
// the list and issues one request per chunk, then aggregates the results.
//
// Body:
//   {
//     "recipients": ["+22462...", ...],
//     "message": "Hello",
//     "sender_name": "MyBrand",     // optional
//     "chunk_size": 50              // optional, max 50
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
  formatGuineanNumber,
  NimbaSMSClient,
  NimbaSMSError,
} from "../_shared/nimba-client.ts";

interface CampaignBody {
  recipients?: string[];
  message?: string;
  sender_name?: string;
  chunk_size?: number;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: CampaignBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = (body.message ?? "").trim();
  const senderName = body.sender_name?.trim() || undefined;
  const chunkSize = body.chunk_size;
  const recipients = (body.recipients ?? [])
    .map((r) => formatGuineanNumber(String(r)))
    .filter(Boolean);

  if (recipients.length === 0) {
    return jsonResponse(
      { error: "`recipients` must be a non-empty array" },
      { status: 400 },
    );
  }
  if (!message) {
    return jsonResponse({ error: "`message` is required" }, { status: 400 });
  }

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

  let client: NimbaSMSClient;
  try {
    client = NimbaSMSClient.fromEnv();
  } catch (err) {
    return jsonResponse(
      { error: (err as Error).message, code: "configuration_error" },
      { status: 500 },
    );
  }

  const sentAt = new Date().toISOString();
  const succeeded: { recipient: string; message_id: string | null }[] = [];
  const failed: { recipient: string; error: string }[] = [];

  const size = Math.min(Math.max(1, chunkSize ?? 50), 50);
  for (let i = 0; i < recipients.length; i += size) {
    const slice = recipients.slice(i, i + size);
    try {
      const result = await client.sendMessage({
        to: slice,
        message,
        senderName,
      });
      const messageId = (result as { messageid?: string }).messageid ?? null;
      slice.forEach((recipient, idx) => {
        succeeded.push({
          recipient,
          // Only the first recipient of each chunk owns the messageid (unique).
          message_id: idx === 0 ? messageId : null,
        });
      });
    } catch (err) {
      const e = err as NimbaSMSError;
      slice.forEach((recipient) => {
        failed.push({ recipient, error: e.message });
      });
    }
  }

  // Persist all attempts in one batch.
  const senderForLog = senderName ?? Deno.env.get("NIMBA_DEFAULT_SENDER") ?? null;
  const rows = [
    ...succeeded.map((s) => ({
      user_id: userId,
      recipient: s.recipient,
      message,
      sender_name: senderForLog,
      message_id: s.message_id,
      status: "sent" as const,
      sent_at: sentAt,
    })),
    ...failed.map((f) => ({
      user_id: userId,
      recipient: f.recipient,
      message,
      sender_name: senderForLog,
      status: "failed" as const,
      error: f.error,
    })),
  ];
  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("sms_logs").insert(rows);
    if (insertError) {
      console.error("sms_logs insert failed", insertError);
    }
  }

  return jsonResponse({
    total: recipients.length,
    sent: succeeded.length,
    failed: failed.length,
    succeeded,
    failures: failed,
  }, { status: failed.length === 0 ? 200 : 207 });
});
