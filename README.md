# Nimba SMS × Supabase 📲

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Deno](https://img.shields.io/badge/runtime-Deno-000?logo=deno)](https://deno.land)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-3ECF8E?logo=supabase&logoColor=fff)](https://supabase.com/docs/guides/functions)

> Send SMS from your Supabase project through **[Nimba SMS](https://nimbasms.com)** — the West African leader in business mobile communication.

This repository ships a production-ready set of Supabase Edge Functions, SQL
migrations and end-to-end examples for connecting Nimba SMS to Supabase Auth,
Database triggers, and your front-end.

---

## Features

- 🚀 **Edge Functions for every Nimba endpoint** — `send-sms`, `sms-webhook`, `check-balance`, `get-sendernames`, `list-messages`, `list-contacts`, `create-contact`, `send-otp`, `confirm-otp`, `verify-otp`
- 🔑 **Two OTP flows out of the box** — Nimba's managed verifications (`send-otp` / `confirm-otp`) **and** a custom hash-and-store flow (`verify-otp`)
- 📦 **Typed Deno client** — `NimbaSMSClient` with timeouts, Basic auth, strict array payloads, typed errors
- 🗄️ **Audit trail in Postgres** — one row per recipient in `sms_logs`, grouped by `batch_id`, status updated by Nimba's delivery-report webhook
- 🔐 **Row Level Security** — users only see their own SMS history
- 🇬🇳 **Smart phone formatting** — auto-prefixes Guinean numbers with `224`
- 🧩 **Ready-to-fork examples** — phone OTP sign-in (HTML + JS) and order confirmation via Postgres trigger
- 🛡️ **Webhook signature verification** — shared-secret authentication for inbound delivery reports

---

## Prerequisites

| Requirement | Where |
| ----------- | ----- |
| Nimba SMS account | [www.nimbasms.com](https://www.nimbasms.com) |
| `ACCOUNT_SID` + `AUTH_TOKEN`<br/>(labelled **SERVICE_ID** and **SECRET_TOKEN** on the Nimba dashboard) | Nimba dashboard → API KEYS |
| Approved Sender ID | Nimba dashboard → Sender Names |
| Supabase project | [supabase.com](https://supabase.com) |
| Supabase CLI ≥ 1.200 | `npm install -g supabase` |
---

## Quickstart

```bash
# 1. Clone & link to your Supabase project
git clone https://github.com/nimbasms/nimbasms-supabase
cd nimbasms-supabase
supabase link --project-ref <your-project-ref>

# 2. Configure secrets
supabase secrets set \
  NIMBA_ACCOUNT_SID=your_account_sid \
  NIMBA_AUTH_TOKEN=your_auth_token \
  NIMBA_DEFAULT_SENDER=YourBrand \
  NIMBA_WEBHOOK_SECRET="$(openssl rand -hex 32)"

# 3. Push migrations
supabase db push

# 4. Deploy functions
supabase functions deploy \
  send-sms sms-webhook check-balance \
  get-sendernames list-messages list-contacts create-contact \
  send-otp confirm-otp verify-otp

# 5. Send a test
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-sms" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["224623273737", "224621000000"],
    "sender_name": "MyApp",
    "message": "Hello from Supabase + Nimba SMS"
  }'
```

Detailed walkthrough → **[docs/QUICKSTART.md](docs/QUICKSTART.md)**.

---

## The send contract

The Nimba REST API exposes a single sending endpoint, `POST /v1/messages`, that
accepts a `to` **array** of 1..50 recipients in every call. This repo mirrors
that contract exactly:

- **One Edge Function** — `send-sms` — handles both single-recipient sends and
  batches; there is no separate "campaign" endpoint to learn.
- **`to` is an array of bare-digit phone numbers with country code**
  (e.g. `"224623273737"`). A leading `+` is stripped. Local Guinean numbers
  (8–9 digits) automatically get the `224` prefix prepended.
- **Max 50 recipients per call.** Split your audience client-side and call the
  function multiple times for larger broadcasts.

```bash
curl -X POST "$SUPABASE_URL/functions/v1/send-sms" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": ["224623273737", "224621000000"],
    "sender_name": "MyApp",
    "message": "Hello from Supabase + Nimba SMS"
  }'
```

---

## Usage examples

### From `supabase-js`

```ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

await supabase.functions.invoke("send-sms", {
  body: {
    to: ["224620000000"],
    sender_name: "MyApp",
    message: "Your order has been confirmed.",
  },
});
```

### Broadcast (still one function — just pass more numbers)

```ts
await supabase.functions.invoke("send-sms", {
  body: {
    to: ["224620000000", "224621000000", "224622000000"],
    sender_name: "MyShop",
    message: "Don't miss our weekend offer!",
  },
});
```

For audiences >50, split client-side and call again:

```ts
for (const chunk of chunkArray(allRecipients, 50)) {
  await supabase.functions.invoke("send-sms", {
    body: { to: chunk, sender_name: "MyShop", message: "..." },
  });
}
```

### Read your logs

```ts
const { data } = await supabase
  .from("sms_logs")
  .select("recipient, status, created_at, batch_id")
  .order("created_at", { ascending: false })
  .limit(20);
```

---

## Use cases

- **📱 Phone OTP sign-in** — custom OTP flow on top of Supabase Auth → see [`examples/phone-otp-auth`](examples/phone-otp-auth) and [`docs/AUTH_OTP_GUIDE.md`](docs/AUTH_OTP_GUIDE.md)
- **🧾 Transactional notifications** — order confirmations, shipping updates, password resets → see [`examples/order-confirmation-trigger`](examples/order-confirmation-trigger)
- **📣 Marketing broadcasts** — pass any number of recipients to `send-sms` (chunk to 50 client-side)
- **🚨 Internal alerts** — wire `pg_net` to `send-sms` from any Postgres trigger to notify ops on critical events

---

## Project layout

```
supabase/
├─ config.toml
├─ functions/
│  ├─ _shared/           ← NimbaSMSClient, CORS, types
│  ├─ send-sms/          POST  /v1/messages
│  ├─ sms-webhook/       ← inbound delivery reports
│  ├─ check-balance/     GET   /v1/accounts
│  ├─ get-sendernames/   GET   /v1/sendernames
│  ├─ list-messages/     GET   /v1/messages
│  ├─ list-contacts/     GET   /v1/contacts
│  ├─ create-contact/    POST  /v1/contacts
│  ├─ send-otp/          POST  /v1/verifications              (managed OTP)
│  ├─ confirm-otp/       PATCH /v1/verifications/{id}         (managed OTP)
│  └─ verify-otp/        ← custom OTP flow (hash + store)
└─ migrations/            ← sms_logs table + RLS policies
examples/
├─ phone-otp-auth/        ← static HTML + JS demo
└─ order-confirmation-trigger/   ← pg_net + Postgres trigger
docs/
├─ QUICKSTART.md
├─ API_REFERENCE.md
└─ AUTH_OTP_GUIDE.md
```

---

## Roadmap

- [ ] Helper hook for **Supabase Auth Phone provider** once the platform supports custom SMS providers
- [ ] Pre-built React / Vue / Svelte components for the OTP UI
- [ ] `groups` Edge Function (`GET /v1/groups`) for contact-group management
- [ ] Optional `pg_cron` job to backfill `delivered_at` by polling `GET /messages/{id}`

Open an issue if you'd like to drive any of these.

---

## Contributing

Pull requests are welcome! Please:

1. Open an issue first for non-trivial changes so we can align on scope.
2. Keep Edge Functions free of heavy dependencies — prefer the Deno standard
   library and small `esm.sh`-hosted packages with pinned versions.
3. Format code with `deno fmt` and run `deno check` on every file.

---

## License

MIT © [Nimba SMS](https://nimbasms.com). See [LICENSE](LICENSE).

## Support

- 🌍 Website — [nimbasms.com](https://nimbasms.com)
- 📚 API docs — [developers.nimbasms.com](https://developers.nimbasms.com)
- ✉️ Contact — [contact@nimbasms.com](mailto:contact@nimbasms.com)
- 🐛 Bugs / feature requests — [GitHub Issues](https://github.com/nimbasms/nimbasms-supabase/issues)
