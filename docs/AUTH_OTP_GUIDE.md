# Phone OTP Authentication Guide

This guide covers **two ways** to build phone OTP sign-in on Supabase with
Nimba SMS:

1. **Managed flow** — Nimba generates, stores, and verifies the code.
   Use the `send-otp` and `confirm-otp` Edge Functions.
2. **Custom flow** — your app generates the code, hashes it, stores it in
   Postgres, and verifies via the `verify-otp` Edge Function. Built on top of
   `send-sms`. A runnable example lives in [`examples/phone-otp-auth`](../examples/phone-otp-auth).

## Which one should I pick?

| Concern                          | Managed (`send-otp`/`confirm-otp`) | Custom (`send-sms`/`verify-otp`) |
| -------------------------------- | ---------------------------------- | -------------------------------- |
| Code generation & storage        | Nimba (server-side)                | Your app (hashed in Postgres)    |
| Rate limiting & attempt caps     | Nimba (built-in)                   | You (Postgres policy)            |
| Audit trail in `sms_logs`        | ❌ No (verifications are separate) | ✅ Yes (every send is logged)    |
| Localizable SMS body             | ✅ Yes (template with `<1234>`)    | ✅ Yes (full control)            |
| Channel options                  | ✅ SMS / WhatsApp / Email          | SMS only                         |
| Works with Supabase Auth hooks   | ✅ Yes (via `confirm-otp` result)  | ✅ Yes                           |
| Lock-in / portability            | Tied to Nimba's `/verifications`   | Logic lives in your codebase     |

**Rule of thumb** — pick the **managed flow** for green-field projects; pick
the **custom flow** when you need a tight audit trail, custom rate limits, or
you already store phone-bound state.

---

## A. Managed flow (recommended)

```
┌──────────┐  1. POST send-otp { to: "224..." }   ┌──────────────┐
│ Browser  │ ──────────────────────────────────▶ │ Edge Function │
│          │                                     │   send-otp    │
│          │                                     └──────┬───────┘
│          │                                            │ POST /v1/verifications
│          │                                            ▼
│          │                                       Nimba SMS API
│          │                                            │
│          │   2. ← { verification_id: "uuid" }         │
│          │                                            │
│          │   3. ← (user receives SMS)                 │
│          │                                            │
│          │  4. POST confirm-otp { verification_id, code: 123456 }
│          │ ──────────────────────────────────▶ Edge Function
│          │                                       confirm-otp
│          │                                            │ PATCH /v1/verifications/{id}
│          │                                            ▼
│          │                                       Nimba SMS API
│          │                                            │
│          │   5. ← { approved: true, status: "approved" }
└──────────┘
```

Client-side sketch (vanilla JS + supabase-js):

```ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Step 1 — request OTP delivery
const { data: send } = await supabase.functions.invoke("send-otp", {
  body: {
    to: "224620000000",
    message: "Code Nimba: <1234>",   // optional, must contain <1234>
    code_length: 6,
    expiry_time: 5,
  },
});
const verificationId = send.verification_id;
// Persist `verificationId` in component state (or sessionStorage).

// Step 2 — submit the code the user typed
const { data: check } = await supabase.functions.invoke("confirm-otp", {
  body: { verification_id: verificationId, code: 123456 },
});
if (check.approved) {
  // → mint a Supabase session for this phone (see "Hooking into Supabase Auth")
}
```

Nimba's enum (`check.status`) tells you *why* a verification didn't pass:

| `status`            | Meaning |
| ------------------- | ------- |
| `pending`           | Queued for delivery |
| `sent`              | Carrier accepted the SMS |
| `received`          | Wrong code submitted (still has attempts) |
| `expired`           | TTL elapsed before approval |
| `too_many_attemps`  | Attempt cap reached |
| `failure`           | Send failed (no balance, invalid sender, etc.) |
| `approved`          | ✅ Code correct — proceed to sign-in |
| `read`              | Verification read (WhatsApp channel only) |

---

## B. Custom flow

Use this pattern when you need a Postgres-side audit trail or custom
rate-limiting that goes beyond what Nimba's managed verifications expose.
It builds on the `send-sms` Edge Function plus the `verify-otp` companion.

```
┌──────────┐  1. Enter phone           ┌─────────┐
│ Browser  │ ────────────────────────▶ │ Postgres│
│          │  2. INSERT otp_codes      │         │
│          │ ────────────────────────▶ │         │
│          │                            └─────────┘
│          │                                │
│          │  3. invoke('send-sms')         │
│          │ ──────────────────────────────▶│
│          │                                ▼
│          │                          Edge Function
│          │                            send-sms ──▶ Nimba SMS API
│          │                                          │
│          │  ◀── 4. SMS delivered ─────────────────  │
│          │                                          │
│          │  5. invoke('verify-otp', { code })       │
│          │ ─────────────────────────────────────────▶
│          │                          Edge Function
│          │                            verify-otp
│          │                                │
│          │  6. { ok: true } ◀────────────│
└──────────┘
```

## Data model

```sql
create table public.otp_codes (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null,
  code_hash    text not null,
  expires_at   timestamptz not null,
  consumed_at  timestamptz,
  attempts     int not null default 0,
  created_at   timestamptz default now()
);
```

Key decisions:

- **Hash, never store plaintext.** The browser computes
  `SHA-256(phone:code)` and inserts the hash. The plaintext code only ever
  lives in transit (SMS body) and in the user's memory.
- **Phone is part of the hash input.** Prevents code reuse across phone
  numbers if your hash table ever leaks.
- **`consumed_at` is monotonic.** Once set, the code is dead. `verify-otp`
  always picks the most recent unused row.
- **Attempt cap.** `verify-otp` increments `attempts` on each miss and locks
  the row at 5 (configurable).

## Security checklist

1. **Rate limit by phone and by IP.** A simple counter on `otp_codes` works:
   ```sql
   create policy "otp_codes_rate_limit"
     on public.otp_codes for insert to anon
     with check (
       (select count(*) from public.otp_codes
        where phone = new.phone
          and created_at > now() - interval '1 hour') < 5
     );
   ```
2. **Short TTL.** Default to 5 minutes (`OTP_TTL_SECONDS` in the example).
   Long TTLs widen the window for brute force.
3. **High-entropy codes.** 6 digits = 1,000,000 combinations. Combined with
   the 5-attempt cap, brute-force odds are 1 in 200,000 per session.
4. **Use a transactional Sender ID.** Marketing Sender IDs are often rate-
   limited or blocked by carriers in West Africa.
5. **Cleanup.** A nightly `pg_cron` job deleting rows older than 24 hours
   keeps the table small and your audit trail tight.

## Hooking into Supabase Auth

Once `verify-otp` confirms the code, you still need a Supabase session. Two
common options:

### Option A — Email-shaped phone alias

Create or look up a user whose email is `<digits>@phone.local`, then use the
admin API to issue a magic-link or password sign-in. The function holding the
service-role key can call:

```ts
const { data, error } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: `${phone.replace(/\D/g, "")}@phone.local`,
});
```

Return `data.action_link` to the client and let `supabase-js` consume it.

### Option B — Sign with a Supabase Auth Hook

Use [Auth Hooks](https://supabase.com/docs/guides/auth/auth-hooks)
(`MFAVerificationAttempt`, `CustomAccessToken`) to attach the verified phone
to an existing user. This keeps your sign-up flow inside Supabase Auth and
delegates only SMS delivery to Nimba.

## Localization

In West Africa, codes mixed with French context perform best:

```
Votre code Nimba: 482 391. Valide 5 minutes.
```

Tip: include a space every 3 digits — easier to type from memory.

## Troubleshooting

| Symptom                                                      | Likely cause |
| ------------------------------------------------------------ | ------------ |
| `"sender_name is required"` from `send-sms` / `send-otp`     | `NIMBA_DEFAULT_SENDER` not set, or the dashboard hasn't approved it yet |
| SMS shows as `sent` but never `delivered`                    | Webhook URL not configured in Nimba, or `NIMBA_WEBHOOK_SECRET` mismatch |
| `send-otp` 400 with "Le motif n'est pas présent dans le message" | Custom `message` is missing the `<1234>` placeholder Nimba uses to inject the code |
| `confirm-otp` returns `status: "too_many_attemps"`           | Caller exceeded the `attempts` cap (3–10) configured at send time — restart the flow |
| `confirm-otp` returns `status: "expired"`                    | More than `expiry_time` minutes elapsed since `send-otp` — restart the flow |
| 401 from `verify-otp` on first try                           | Browser-side phone formatting differs from the inserted row — both sides must use the same `formatGuineanNumber()` |
| `"No active code for this phone"`                            | Row was already consumed, expired, or `phone` value drifted |
