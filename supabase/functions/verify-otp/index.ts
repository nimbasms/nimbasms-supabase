// POST /functions/v1/verify-otp
//
// Companion to the `send-sms`-based OTP flow. Compares a 6-digit code provided
// by the user against the most recent unused entry in `public.otp_codes` for
// that phone number, marks it consumed on success, and returns a short-lived
// success token your app can use to complete sign-in.
//
// This function is intentionally public (verify_jwt=false) so unauthenticated
// users completing sign-up can call it.
//
// Body:
//   { "phone": "+224620000000", "code": "123456" }
//
// Companion table (see examples/phone-otp-auth/README.md):
//
//   create table public.otp_codes (
//     id uuid primary key default gen_random_uuid(),
//     phone text not null,
//     code_hash text not null,
//     expires_at timestamptz not null,
//     consumed_at timestamptz,
//     attempts int not null default 0,
//     created_at timestamptz default now()
//   );

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.46.1";
import { handlePreflight, jsonResponse } from "../_shared/cors.ts";
import { formatGuineanNumber } from "../_shared/nimba-client.ts";

const MAX_ATTEMPTS = 5;

interface VerifyBody {
  phone?: string;
  code?: string;
}

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, { status: 405 });
  }

  let body: VerifyBody;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, { status: 400 });
  }

  const phone = formatGuineanNumber(String(body.phone ?? ""));
  const code = (body.code ?? "").toString().trim();

  if (!phone) {
    return jsonResponse({ error: "`phone` is required" }, { status: 400 });
  }
  if (!/^\d{4,8}$/.test(code)) {
    return jsonResponse({ error: "`code` must be 4–8 digits" }, { status: 400 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } },
  );

  // Fetch the latest unconsumed code for this phone.
  const { data: row, error: selectError } = await supabase
    .from("otp_codes")
    .select("id, code_hash, expires_at, consumed_at, attempts")
    .eq("phone", phone)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (selectError) {
    console.error("otp_codes select failed", selectError);
    return jsonResponse({ error: "Internal error" }, { status: 500 });
  }
  if (!row) {
    return jsonResponse({ error: "No active code for this phone" }, { status: 404 });
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return jsonResponse({ error: "Code expired" }, { status: 410 });
  }
  if (row.attempts >= MAX_ATTEMPTS) {
    return jsonResponse({ error: "Too many attempts" }, { status: 429 });
  }

  const submittedHash = await sha256Hex(`${phone}:${code}`);
  const ok = timingSafeEqual(submittedHash, row.code_hash);

  if (!ok) {
    await supabase
      .from("otp_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    return jsonResponse({ error: "Invalid code" }, { status: 401 });
  }

  await supabase
    .from("otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  return jsonResponse({ ok: true, phone });
});

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
