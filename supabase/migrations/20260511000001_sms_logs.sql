-- ────────────────────────────────────────────────────────────────────────────
-- sms_logs — one row per recipient per send attempt
--
-- A single call to `POST /v1/messages` may deliver to up to 50 recipients and
-- returns a single `messageid`. We persist ONE row per recipient (same
-- `message_id`, same `batch_id`) so that:
--   * each recipient owns its own status / delivered_at timeline,
--   * the inbound delivery-report webhook can pinpoint the exact row using
--     (message_id, recipient).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.sms_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  recipient     text not null,
  message       text not null,
  sender_name   text,
  message_id    text,
  batch_id      uuid,
  status        text not null default 'pending'
                  check (status in ('pending','sent','delivered','failed')),
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz
);

create index if not exists sms_logs_user_id_idx     on public.sms_logs (user_id);
create index if not exists sms_logs_message_id_idx  on public.sms_logs (message_id);
create index if not exists sms_logs_batch_id_idx    on public.sms_logs (batch_id);
create index if not exists sms_logs_status_idx      on public.sms_logs (status);
create index if not exists sms_logs_recipient_idx   on public.sms_logs (recipient);
create index if not exists sms_logs_created_at_idx  on public.sms_logs (created_at desc);

-- The webhook updates by (message_id, recipient). Make that lookup fast and
-- enforce that we never end up with two rows for the same recipient in the
-- same batch.
create unique index if not exists sms_logs_message_id_recipient_uidx
  on public.sms_logs (message_id, recipient)
  where message_id is not null;

comment on table  public.sms_logs               is 'Outbound SMS attempts dispatched through Nimba SMS (one row per recipient).';
comment on column public.sms_logs.message_id    is 'Provider-side message identifier (Nimba `messageid`). Shared across all recipients of a single API call.';
comment on column public.sms_logs.batch_id      is 'Local UUID grouping every recipient of a single send-sms invocation.';
comment on column public.sms_logs.status        is 'pending → sent (handed off to Nimba) → delivered (carrier ack) / failed.';
comment on column public.sms_logs.error         is 'Last-known provider or local error message, if any.';
