# Nimba SMS × Supabase 📲

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Deno](https://img.shields.io/badge/runtime-Deno-000?logo=deno)](https://deno.land)
[![Supabase](https://img.shields.io/badge/Supabase-Edge%20Functions-3ECF8E?logo=supabase&logoColor=fff)](https://supabase.com/docs/guides/functions)

> Send SMS from your Supabase project through **[Nimba SMS](https://nimbasms.com)** — the West African leader in business mobile communication.

This repository ships a production-ready set of Supabase Edge Functions,
SQL migrations and end-to-end examples for connecting Nimba SMS to Supabase
Auth, Database triggers, and your front-end.

---

## Features

- 🚀 **Drop-in Edge Functions** — `send-sms`, `send-campaign`, `sms-webhook`, `check-balance`, `verify-otp`
- 📦 **Typed Deno client** — `NimbaSMSClient` with timeouts, basic-auth, batch sends, and typed errors
- 🗄️ **Audit trail in Postgres** — every send is logged in `sms_logs` with status updates from Nimba's delivery-report webhook
- 🔐 **Row Level Security** — users only ever see their own SMS history
- 🇬🇳 **Smart phone formatting** — auto-prefixes Guinean numbers with `+224`
- 🧩 **Ready-to-fork examples** — phone OTP sign-in (HTML + JS) and order confirmation via Postgres trigger
- 🛡️ **Webhook signature verification** — shared-secret authentication for inbound delivery reports

---

## Prerequisites

| Requirement       | Where                                                       |
| ----------------- | ----------------------------------------------------------- |
| Nimba SMS account | [www.nimbasms.com](https://www.nimbasms.com)                |
| `SERVICE_ID` + `SECRET_TOKEN` | Nimba dashboard → Settings → API              |
| Approved Sender ID | Nimba dashboard → Sender Names                             |
| Supabase project  | [supabase.com](https://supabase.com)                        |
| Supabase CLI ≥ 1.200 | `npm install -g supabase`                                |

---

## Quickstart

```bash
# 1. Clone & link to your Supabase project
git clone https://github.com/nimbasms/nimbasms-supabase
cd nimbasms-supabase
supabase link --project-ref <your-project-ref>

# 2. Configure secrets
supabase secrets set \
  NIMBA_SERVICE_ID=your_service_id \
  NIMBA_SECRET_TOKEN=your_secret_token \
  NIMBA_DEFAULT_SENDER=YourBrand \
  NIMBA_WEBHOOK_SECRET="$(openssl rand -hex 32)"

# 3. Push migrations
supabase db push

# 4. Deploy functions
supabase functions deploy send-sms send-campaign sms-webhook check-balance verify-otp

# 5. Send a test
curl -X POST "https://<project-ref>.supabase.co/functions/v1/send-sms" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "to": "+224620000000", "message": "Hello from Nimba SMS!" }'
```

That's it. Detailed walkthrough → **[docs/QUICKSTART.md](docs/QUICKSTART.md)**.

---

## Usage examples

### From `supabase-js`

```ts
import { createClient } from "@supabase/supabase-js";
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

await supabase.functions.invoke("send-sms", {
  body: {
    to: "+224620000000",
    message: "Your order has been confirmed.",
  },
});
```

### Batch (broadcast)

```ts
await supabase.functions.invoke("send-campaign", {
  body: {
    recipients: ["+224620000000", "+224621000000", "+224622000000"],
    message: "Don't miss our weekend offer!",
    sender_name: "MyShop",
  },
});
```

### Read your logs

```ts
const { data } = await supabase
  .from("sms_logs")
  .select("recipient, status, created_at")
  .order("created_at", { ascending: false })
  .limit(20);
```

---

## Use cases

- **📱 Phone OTP sign-in** — custom OTP flow on top of Supabase Auth → see [`examples/phone-otp-auth`](examples/phone-otp-auth) and [`docs/AUTH_OTP_GUIDE.md`](docs/AUTH_OTP_GUIDE.md)
- **🧾 Transactional notifications** — order confirmations, shipping updates, password resets → see [`examples/order-confirmation-trigger`](examples/order-confirmation-trigger)
- **📣 Marketing campaigns** — chunked broadcasts via `send-campaign`
- **🚨 Internal alerts** — wire `pg_net` to `send-sms` from any Postgres trigger to notify ops on critical events

---

## Project layout

```
supabase/
├─ config.toml
├─ functions/
│  ├─ _shared/        ← NimbaSMSClient, CORS, types
│  ├─ send-sms/
│  ├─ send-campaign/
│  ├─ sms-webhook/
│  ├─ check-balance/
│  └─ verify-otp/
└─ migrations/        ← sms_logs table + RLS policies
examples/
├─ phone-otp-auth/    ← static HTML + JS demo
└─ order-confirmation-trigger/   ← pg_net + Postgres trigger
docs/
├─ QUICKSTART.md
├─ API_REFERENCE.md
└─ AUTH_OTP_GUIDE.md
```

---

## Roadmap

- [ ] Optional native `POST /v1/verifications` OTP wrapper (Nimba's hosted OTP service)
- [ ] Helper hook for **Supabase Auth Phone provider** once the platform supports custom SMS providers
- [ ] Pre-built React / Vue / Svelte components for the OTP UI
- [ ] Contact list sync with Nimba SMS contacts API
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
