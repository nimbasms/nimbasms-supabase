# Quickstart

Get your first SMS out through Nimba SMS in under 5 minutes.

## 1. Prerequisites

- A Supabase project (cloud or self-hosted) and the [Supabase CLI](https://supabase.com/docs/guides/cli) v1.200+
- A Nimba SMS account ([www.nimbasms.com](https://www.nimbasms.com)) with
  - an `ACCOUNT_SID` and `AUTH_TOKEN` (Settings → Developeurs — they are labelled
    **SERVICE_ID** and **SECRET_TOKEN** in the dashboard but the SDK calls
    them ACCOUNT_SID/AUTH_TOKEN)
  - at least one approved Sender ID
- Node 18+ or Deno 1.40+ on your dev machine

## 2. Clone & link

```bash
git clone https://github.com/nimbasms/nimbasms-supabase
cd nimbasms-supabase

supabase link --project-ref <your-project-ref>
```

## 3. Configure secrets

```bash
supabase secrets set \
  NIMBA_ACCOUNT_SID=your_account_sid \
  NIMBA_AUTH_TOKEN=your_auth_token \
  NIMBA_DEFAULT_SENDER=YourBrand \
  NIMBA_WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

> `NIMBA_DEFAULT_SENDER` must match a Sender ID approved in your Nimba dashboard.

## 4. Apply migrations

```bash
supabase db push
```

This creates `public.sms_logs` and the RLS policies.

## 5. Deploy the functions

```bash
supabase functions deploy \
  send-sms sms-webhook check-balance \
  get-sendernames list-messages list-contacts create-contact \
  send-otp confirm-otp verify-otp
```

## 6. Send a test message

```bash
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-sms" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["224623273737"],
    "sender_name": "MyApp",
    "message": "Hello from Nimba SMS!"
  }'
```

Expected response:

```json
{
  "message_id": "8f12…",
  "batch_id":   "9e3b…",
  "recipients": ["224623273737"],
  "status":     "sent",
  "wrapped_single": false
}
```

A row should now appear in `public.sms_logs` with `status = 'sent'`.

## 7. Wire up the delivery-report webhook

In your Nimba dashboard, set the webhook URL to:

```
https://<project-ref>.supabase.co/functions/v1/sms-webhook?secret=<NIMBA_WEBHOOK_SECRET>
```

or, if your dashboard supports custom headers:

```
URL:     https://<project-ref>.supabase.co/functions/v1/sms-webhook
Header:  x-nimba-signature: <NIMBA_WEBHOOK_SECRET>
```

Once Nimba posts back, each recipient row of the batch flips to `delivered`
(or `failed`) and `delivered_at` is filled.

## Next steps

- **[AUTH_OTP_GUIDE.md](AUTH_OTP_GUIDE.md)** — build a custom phone OTP sign-in
- **[API_REFERENCE.md](API_REFERENCE.md)** — endpoint and payload reference
- **[examples/order-confirmation-trigger](../examples/order-confirmation-trigger)** — fire SMS from a Postgres trigger
