// POST /functions/v1/confirm-otp
//
// Submits a user-typed OTP code to Nimba SMS's managed verification flow
// (`PATCH /v1/verifications/{verificationid}`). The verification ID is the
// one returned by `send-otp`.
//
// Body:
//   {
//     "verification_id": "uuid",
//     "code": 123456                 // 4..8 digits, sent as integer to Nimba
//   }
//
// Response — 200:
//   { "approved": true,  "status": "approved" }   // code correct
//   { "approved": false, "status": "received" }   // wrong code (still has attempts)
//
// Errors:
//   - 400 — invalid input, expired code, attempts exhausted (Nimba bubbles up)
//   - 404 — verification ID unknown
//   - 429 — rate limited
//
// This function is intentionally public (verify_jwt = false) so unauthenticated
// users completing sign-up can call it. Nimba enforces per-verification
// rate limits and attempt caps on the server side.

import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import {
  NimbaSMSClient,
  NimbaSMSError,
} from "../_shared/nimba-client.ts";

interface ConfirmOtpBody {
  verification_id?: string;
  code?: string | number;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: ConfirmOtpBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const verificationId = (body.verification_id ?? "").toString().trim();
  if (!verificationId) {
    return jsonResponse(
      { error: "`verification_id` is required" },
      { status: 400 },
    );
  }
  if (body.code === undefined || body.code === null || body.code === "") {
    return jsonResponse({ error: "`code` is required" }, { status: 400 });
  }
  const codeNum = typeof body.code === "string"
    ? Number.parseInt(body.code, 10)
    : body.code;
  if (!Number.isFinite(codeNum) || codeNum < 0) {
    return jsonResponse(
      { error: "`code` must be a positive integer" },
      { status: 400 },
    );
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
    const result = await client.checkVerification({
      verificationId,
      code: codeNum,
    });
    return jsonResponse({
      approved: result.status === "approved",
      status: result.status,
    });
  } catch (err) {
    const e = err as NimbaSMSError;
    const status = e.status && e.status >= 400 ? e.status : 502;
    return jsonResponse(
      { error: e.message, code: e.code ?? "confirm_otp_failed", body: e.body },
      { status },
    );
  }
});
