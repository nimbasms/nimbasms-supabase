// POST /functions/v1/send-otp
//
// Triggers Nimba SMS's managed OTP flow by calling `POST /v1/verifications`.
// Nimba generates the code, sends the SMS, and tracks the verification
// server-side (TTL, attempts, status). The returned `verification_id` must
// be passed back when calling `confirm-otp` to verify the user-typed code.
//
// Body:
//   {
//     "to": "224623273737",          // required (single phone number)
//     "sender_name": "MyApp",        // optional, falls back to NIMBA_DEFAULT_SENDER
//     "message": "Code: <1234>",     // optional, must contain `<1234>` placeholder
//     "expiry_time": 5,              // optional, 5..30 minutes
//     "attempts": 3,                 // optional, 3..10
//     "code_length": 6,              // optional, 4..8
//     "channel": "sms"               // optional: sms | whatsapp | email
//   }
//
// Response — 201:
//   { "verification_id": "uuid", "message_cost": 1, "url": "..." }

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { NimbaSMSClient, NimbaSMSError } from "../_shared/nimba-client.ts";

interface SendOtpBody {
  to?: string;
  sender_name?: string;
  message?: string;
  expiry_time?: number;
  attempts?: number;
  code_length?: number;
  channel?: "sms" | "whatsapp" | "email";
  language?: "fr" | "en_US";
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: SendOtpBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const to = (body.to ?? "").toString().trim();
  if (!to) {
    return jsonResponse({ error: "`to` is required" }, { status: 400 });
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

  try {
    const result = await client.createVerification({
      to,
      senderName: body.sender_name,
      message: body.message,
      expiryTime: body.expiry_time,
      attempts: body.attempts,
      codeLength: body.code_length,
      channel: body.channel,
      language: body.language,
    });
    return jsonResponse(
      {
        verification_id: result.verificationid,
        message_cost: result.message_cost ?? null,
        url: result.url ?? null,
      },
      { status: 201 },
    );
  } catch (err) {
    const e = err as NimbaSMSError;
    const status = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "send_otp_failed", body: e.body },
      { status },
    );
  }
});
