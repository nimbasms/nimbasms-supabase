# API Reference

Every Edge Function in this project is exposed at
`https://<project-ref>.supabase.co/functions/v1/<name>`. Unless noted
otherwise, requests must carry a Supabase `Authorization: Bearer <jwt>`
header (anon, user, or service-role).

The underlying Nimba SMS REST API uses **HTTP Basic auth** with
`NIMBA_ACCOUNT_SID` (username) and `NIMBA_AUTH_TOKEN` (password). The Nimba
dashboard labels these `SERVICE_ID` and `SECRET_TOKEN` respectively.

---

## `POST /send-sms`

The only sending endpoint. Wraps `POST /v1/messages` 1:1.

**Request**

```jsonc
{
  "to": ["224623273737", "224621000000"],   // array of 1..50 phone numbers
  "sender_name": "MyApp",                   // optional → NIMBA_DEFAULT_SENDER
  "message": "Hello, world!"                // required, ≤ 665 chars
}
```

`to` may also be a single string for convenience — the function wraps it into
a 1-element array and returns `wrapped_single: true` so callers can detect
the coercion. Pass an array whenever possible to match the wire contract.

**Response — `200 OK`**

```json
{
  "message_id":     "8f12abc…",
  "batch_id":       "9e3bcd…",
  "recipients":     ["224623273737", "224621000000"],
  "status":         "sent",
  "wrapped_single": false,
  "provider_response": { "messageid": "8f12abc…" }
}
```

**Errors**

| Status | When |
| ------ | ---- |
| `400`  | Invalid body — missing `to`/`message`, malformed JSON, no valid recipients, or more than 50 recipients |
| `401`  | Missing or invalid Supabase JWT |
| `502`  | Nimba SMS rejected the request — see `error` + `code` fields |
| `500`  | Server is misconfigured (missing `NIMBA_ACCOUNT_SID` / `NIMBA_AUTH_TOKEN`) |

Each successful send writes **one row per recipient** into `public.sms_logs`,
all sharing the same `message_id` and `batch_id`.

---

## `GET /check-balance`

Returns the SMS credit balance. Wraps `GET /v1/accounts`.

**Response — `200 OK`**

```json
{ "balance": { "sms": 1234 } }
```

---

## `GET /get-sendernames`

Lists Sender IDs registered on the account. Wraps `GET /v1/sendernames`.

**Query params** — `limit` (default 100), `offset` (default 0)

**Response — `200 OK`**

```json
{
  "results": [
    { "name": "MyBrand", "status": "accepted" },
    { "name": "Beta",    "status": "pending"  }
  ],
  "next": null
}
```

---

## `GET /list-messages`

Paginated message history from Nimba SMS. Wraps `GET /v1/messages`.

**Query params** — `limit`, `offset`, `search` (free-text), `status` (one of
`sent`, `received`, `failure`, `no_credit`, `not_available`)

**Response — `200 OK`** — Nimba paginated payload `{ results: [...], next, count }`.

---

## `GET /list-contacts`

Lists contacts saved on the Nimba account. Wraps `GET /v1/contacts`.

**Query params** — `limit`, `offset`, `search`

**Response — `200 OK`** — Nimba paginated payload `{ results: [...], next, count }`.

---

## `POST /create-contact`

Creates a contact on the Nimba account. Wraps `POST /v1/contacts`.

**Request**

```jsonc
{
  "numero": "224623000000",   // required
  "name":   "Aisha Camara",   // optional
  "groups": ["clients"]       // optional, array of group slugs/names
}
```

**Response — `201 Created`** — the created contact as returned by Nimba.

---

## `POST /sms-webhook`

Receives delivery reports from Nimba SMS. Authenticated via shared secret —
NOT a Supabase JWT (configure `verify_jwt = false` in `config.toml`).

**Expected payload (from Nimba)**

```json
{
  "messageid": "8f12abc…",
  "contact":   "224623273737",
  "status":    "received",
  "error":     null,
  "metadata":  { "message_type": "API" }
}
```

The function updates the `sms_logs` row matching `(message_id, recipient)`.

**Status mapping**

| Nimba `status` | `sms_logs.status` |
| -------------- | ----------------- |
| `received` | `delivered` |
| `sent` | `sent` |
| `failed`, `failure`, `no_credit`, `not_available` | `failed` |
| anything else | `pending` |

Accepts the secret in either the `x-nimba-signature` header or a `?secret=`
query string (`NIMBA_WEBHOOK_SECRET`).

---

## `POST /send-otp`

Triggers Nimba SMS's **managed verification flow** (`POST /v1/verifications`).
Nimba generates the code, sends the SMS, and tracks the verification
server-side (TTL, attempts). The returned `verification_id` must be passed
back when calling `confirm-otp`.

**Request**

```jsonc
{
  "to":           "224623273737",       // required, single phone number
  "sender_name":  "MyApp",              // optional → NIMBA_DEFAULT_SENDER
  "message":      "Your code: <1234>",  // optional, must contain `<1234>`
  "expiry_time":  5,                    // optional, 5..30 minutes
  "attempts":     3,                    // optional, 3..10
  "code_length":  6,                    // optional, 4..8 (default 4)
  "channel":      "sms"                 // optional: sms | whatsapp | email
}
```

**Response — `201 Created`**

```json
{
  "verification_id": "5efd1356-2d84-4a3e-962f-bc4c29ce0c75",
  "message_cost":    1,
  "url":             "https://api.nimbasms.com/v1/verifications/..."
}
```

**Errors** — `400` (validation, invalid template, insufficient balance),
`401` (auth), `429` (rate limit), `502` (Nimba upstream error).

---

## `POST /confirm-otp`

Submits the code typed by the user to Nimba's managed verification
(`PATCH /v1/verifications/{verificationid}`).

**Request**

```json
{ "verification_id": "5efd1356-…", "code": 123456 }
```

`code` is sent to Nimba as an integer per the official OpenAPI spec.
This endpoint also accepts a string and parses it.

**Response — `200 OK`**

```json
{ "approved": true,  "status": "approved" }   // code correct
{ "approved": false, "status": "received" }   // wrong but still has attempts
```

`status` mirrors Nimba's enum: `pending`, `sent`, `expired`, `failure`,
`received`, `too_many_attemps`, `approved`, `read`.

**Errors** — `400` (expired, attempts exhausted, malformed code),
`404` (verification ID unknown), `429` (rate limit), `502` (upstream).

---

## `POST /verify-otp`

Pairs with the **custom OTP example** to verify a code stored in
`public.otp_codes`. Use `confirm-otp` for the Nimba-managed flow above.

**Request**

```json
{ "phone": "224623000000", "code": "123456" }
```

**Response — `200 OK`**

```json
{ "ok": true, "phone": "224623000000" }
```

**Errors** — `400` (invalid input), `401` (wrong code), `404` (no active
code), `410` (expired), `429` (≥ 5 attempts).

---

## Underlying Nimba SMS endpoints

For reference, every Edge Function above wraps exactly one Nimba endpoint:

| Method | Path                                  | Edge Function    |
| ------ | ------------------------------------- | ---------------- |
| POST   | `/v1/messages`                        | `send-sms`       |
| GET    | `/v1/messages`                        | `list-messages`  |
| GET    | `/v1/accounts`                        | `check-balance`  |
| GET    | `/v1/sendernames`                     | `get-sendernames`|
| GET    | `/v1/contacts`                        | `list-contacts`  |
| POST   | `/v1/contacts`                        | `create-contact` |
| POST   | `/v1/verifications`                   | `send-otp`       |
| PATCH  | `/v1/verifications/{verificationid}`  | `confirm-otp`    |

Auth: HTTP Basic with `NIMBA_ACCOUNT_SID` (user) and `NIMBA_AUTH_TOKEN`
(password).
