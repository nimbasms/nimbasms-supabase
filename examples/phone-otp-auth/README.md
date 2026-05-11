# Phone OTP Authentication

A self-contained example showing how to add SMS-based one-time password (OTP)
sign-in to a Supabase project, using **Nimba SMS** as the delivery channel.

## Flow

1. User types their phone number in `index.html`.
2. The browser generates a random 6-digit code, hashes it (`SHA-256(phone:code)`),
   stores the hash in `public.otp_codes`, then asks the `send-sms` Edge
   Function to deliver the plaintext code via Nimba SMS.
3. User types the received code; the browser calls `verify-otp`, which
   compares hashes and marks the row consumed.
4. On success, your app proceeds (e.g. `signInWithPassword`, custom JWT, etc.).

## Companion table — run once

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

create index on public.otp_codes (phone);
create index on public.otp_codes (expires_at);

alter table public.otp_codes enable row level security;

-- Anonymous users insert (browser writes the hashed code before calling
-- send-sms). Tighten this if you front the table with an Edge Function.
create policy "otp_codes_insert_anon"
  on public.otp_codes
  for insert
  to anon
  with check (true);

-- No one reads otp_codes directly; verify-otp uses the service-role key.
revoke select on public.otp_codes from anon, authenticated;
```

Optionally schedule a cleanup job (e.g. via `pg_cron`) to delete expired rows:

```sql
delete from public.otp_codes where expires_at < now() - interval '1 day';
```

## Configuration

In the `<script>` block at the bottom of `index.html`, replace:

- `SUPABASE_URL` with `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` with your project's anon key

Make sure the following secrets are set on the Supabase project:

```bash
supabase secrets set \
  NIMBA_SERVICE_ID=xxx \
  NIMBA_SECRET_TOKEN=xxx \
  NIMBA_DEFAULT_SENDER=YourBrand
```

## Run locally

Any static file server will do — the page only talks to Supabase over HTTPS:

```bash
npx serve examples/phone-otp-auth
# then open http://localhost:3000
```

## Production checklist

- Rate-limit by IP and by phone number (the `send-sms` function or a
  Postgres trigger on `otp_codes`).
- Lock the `otp_codes` insert policy to a single Edge Function instead of
  anon — recommended once your traffic grows.
- Use a Sender ID approved for transactional messages in your Nimba dashboard.
- Localize the SMS body (`Votre code: …`) for your audience.
