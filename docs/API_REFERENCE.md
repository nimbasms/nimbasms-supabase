# API Reference

Every Edge Function in this project is exposed at
`https://<project-ref>.supabase.co/functions/v1/<name>`. Unless noted
otherwise, requests must carry a Supabase `Authorization: Bearer <jwt>`
header (anon, user, or service-role).

---

## `POST /send-sms`

Send one SMS or a batch of up to 50 in a single Nimba call.

**Request**

```jsonc
{
  "to": "+224620000000",            // string OR string[]
  "message": "Hello, world!",       // required, ≤ 665 chars
  "sender_name": "MyBrand"          // optional, falls back to NIMBA_DEFAULT_SENDER
}
```

**Response — `200 OK`**

```json
{
  "message_id": "8f12abc...",
  "recipients": ["+224620000000"],
  "status": "sent",
  "provider_response": { "messageid": "8f12abc..." }
}
```

**Errors**

| Status | When |
| ------ | ---- |
| `400`  | Invalid body — missing `to`/`message`, malformed JSON, no valid recipients |
| `401`  | Missing or invalid Supabase JWT |
| `502`  | Nimba SMS rejected the request — see `error` + `code` fields |
| `500`  | Server is misconfigured (missing `NIMBA_SERVICE_ID` / `NIMBA_SECRET_TOKEN`) |

Each successful send also writes one row per recipient into `public.sms_logs`.

---

## `POST /send-campaign`

Same as `send-sms` but designed for broadcasts: takes a `recipients` array of
arbitrary size and chunks it into Nimba calls of 50 numbers each.

**Request**

```jsonc
{
  "recipients": ["+224620000000", "+224621000000", "..."],
  "message": "Promo this week only!",
  "sender_name": "MyBrand",         // optional
  "chunk_size": 50                  // optional, 1–50
}
```

**Response — `200` (all sent) or `207` (partial failure)**

```json
{
  "total": 120,
  "sent": 118,
  "failed": 2,
  "succeeded": [ { "recipient": "+224...", "message_id": "abc..." } ],
  "failures":  [ { "recipient": "+224...", "error": "no_credit" } ]
}
```

---

## `GET /check-balance`

Returns the current SMS credit and the list of approved Sender IDs.

**Response — `200 OK`**

```json
{
  "balance": { "sms": 1234 },
  "sender_names": [
    { "name": "MyBrand",  "status": "accepted" },
    { "name": "Beta",     "status": "pending"  }
  ]
}
```

---

## `POST /sms-webhook`

Receives delivery reports from Nimba SMS. Authenticated via shared secret —
NOT a Supabase JWT (configure `verify_jwt = false` in `config.toml`).

**Expected payload (from Nimba)**

```json
{
  "messageid": "8f12abc...",
  "contact":   "+224620000000",
  "status":    "received",
  "error":     null,
  "metadata":  { "message_type": "API" }
}
```

**Status mapping**

| Nimba `status`              | `sms_logs.status` |
| --------------------------- | ----------------- |
| `received`                  | `delivered`       |
| `sent`                      | `sent`            |
| `failed`, `failure`, `no_credit`, `not_available` | `failed` |
| anything else               | `pending`         |

The endpoint accepts the secret in either `x-nimba-signature` header or a
`?secret=` query string (`NIMBA_WEBHOOK_SECRET`).

---

## `POST /verify-otp`

Pairs with the OTP example to verify a 6-digit code stored in
`public.otp_codes`.

**Request**

```json
{ "phone": "+224620000000", "code": "123456" }
```

**Response — `200 OK`**

```json
{ "ok": true, "phone": "+224620000000" }
```

**Errors** — `400` (invalid input), `401` (wrong code), `404` (no active
code), `410` (expired), `429` (≥ 5 attempts).

---

## Underlying Nimba SMS endpoints

For reference, this project calls only the following Nimba SMS endpoints:

| Method | Path                       | Purpose                  |
| ------ | -------------------------- | ------------------------ |
| POST   | `/v1/messages`             | Send (single or batch)   |
| GET    | `/v1/accounts`             | Account / credit balance |
| GET    | `/v1/sendernames`          | List approved Sender IDs |
| GET    | `/v1/messages/{id}`        | Fetch a single message   |

Authentication: HTTP Basic with `SERVICE_ID` (user) and `SECRET_TOKEN`
(password).
