# Phone OTP Authentication Guide

This guide describes the recommended pattern for building **phone OTP sign-in**
on Supabase using Nimba SMS as the delivery channel. It walks through the
data model, the two Edge Functions involved, and the security considerations
that matter at scale.

A runnable example lives in [`examples/phone-otp-auth`](../examples/phone-otp-auth).

---

## Why a custom flow?

Supabase Auth ships with native phone OTP (Twilio, MessageBird, Vonage,
TextLocal). Nimba SMS is not in the built-in list, so we replicate the same
contract ourselves on top of the `send-sms` Edge Function.

The flow:

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
| `"sender_name is required"` from `send-sms`                  | `NIMBA_DEFAULT_SENDER` not set, or the dashboard hasn't approved it yet |
| SMS shows as `sent` but never `delivered`                    | Webhook URL not configured in Nimba, or `NIMBA_WEBHOOK_SECRET` mismatch |
| 401 from `verify-otp` on first try                           | Browser-side phone formatting differs from the inserted row — both sides must use the same `formatGuineanNumber()` |
| `"No active code for this phone"`                            | Row was already consumed, expired, or `phone` value drifted |
