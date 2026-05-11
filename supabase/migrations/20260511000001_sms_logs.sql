-- ────────────────────────────────────────────────────────────────────────────
-- sms_logs — one row per recipient per send attempt
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.sms_logs (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references auth.users(id) on delete set null,
  recipient     text not null,
  message       text not null,
  sender_name   text,
  message_id    text unique,
  status        text not null default 'pending'
                  check (status in ('pending','sent','delivered','failed')),
  error         text,
  created_at    timestamptz not null default now(),
  sent_at       timestamptz,
  delivered_at  timestamptz
);

create index if not exists sms_logs_user_id_idx     on public.sms_logs (user_id);
create index if not exists sms_logs_message_id_idx  on public.sms_logs (message_id);
create index if not exists sms_logs_status_idx      on public.sms_logs (status);
create index if not exists sms_logs_recipient_idx   on public.sms_logs (recipient);
create index if not exists sms_logs_created_at_idx  on public.sms_logs (created_at desc);

comment on table  public.sms_logs               is 'Outbound SMS attempts dispatched through Nimba SMS.';
comment on column public.sms_logs.message_id    is 'Provider-side message identifier (Nimba `messageid`). Unique per batch.';
comment on column public.sms_logs.status        is 'pending → sent (handed off to Nimba) → delivered (carrier ack) / failed.';
comment on column public.sms_logs.error         is 'Last-known provider or local error message, if any.';
