# Order Confirmation Trigger

Send an SMS automatically whenever a new row is inserted into `public.orders`,
using the `send-sms` Edge Function and the `pg_net` extension.

## How it works

```
INSERT INTO orders ─► AFTER INSERT trigger ─► pg_net.http_post
                                                  │
                                                  ▼
                                  Edge Function `send-sms`
                                                  │
                                                  ▼
                                  Nimba SMS API → customer
```

This pattern works for any "fire-and-forget" notification:

- Password reset emails (swap the function for `send-email`)
- Shipping updates (`UPDATE orders SET status='shipped'`)
- Inventory alerts (`UPDATE products SET stock_qty …` → notify ops)

## Prerequisites

- The Edge Functions deployed (`supabase functions deploy send-sms`).
- Project secrets set (`NIMBA_ACCOUNT_SID`, `NIMBA_AUTH_TOKEN`, `NIMBA_DEFAULT_SENDER`).
- A way to reach `send-sms` from Postgres. Two options:
  1. **`pg_net`** (used here) — built-in to Supabase, asynchronous, doesn't
     block the transaction. Available via `extensions.http_post`.
  2. **Database Webhooks** — configured in the Supabase Studio UI, no SQL
     required. Pick this if you prefer point-and-click.

## Install

Run the SQL in `trigger.sql` against your project (Studio SQL editor or
`supabase db push`). Before running it, edit the two placeholders near the
top:

```sql
project_url      := 'https://YOUR-PROJECT-REF.supabase.co';
service_role_key := 'YOUR_SERVICE_ROLE_KEY';
```

> **Note** — embedding the service-role key in a database function is
> acceptable because the function lives inside Postgres and is never exposed
> to clients. Still, restrict it via Vault if your team has shared SQL access.

## Test

```sql
insert into public.orders (customer_phone, total_xof)
values ('224620000000', 12500);
```

Within a couple of seconds you should:

1. See a new row in `public.sms_logs` with `status = 'sent'`.
2. Receive the SMS on the test phone.
3. (Once Nimba posts the delivery report to `sms-webhook`) see the row
   transition to `status = 'delivered'`.
