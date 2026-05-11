-- ────────────────────────────────────────────────────────────────────────────
-- Order Confirmation Trigger
--
-- Sends an SMS via the `send-sms` Edge Function whenever a row is inserted
-- into public.orders. Relies on the `pg_net` extension (preinstalled on
-- Supabase) for asynchronous HTTP calls.
-- ────────────────────────────────────────────────────────────────────────────

create extension if not exists pg_net with schema extensions;

-- Example orders table — adapt the columns to your real schema.
create table if not exists public.orders (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users(id) on delete set null,
  customer_phone  text not null,
  total_xof       integer not null check (total_xof >= 0),
  status          text not null default 'new',
  created_at      timestamptz not null default now()
);

-- ── Trigger function ────────────────────────────────────────────────────────

create or replace function public.notify_order_created()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  project_url      text := 'https://YOUR-PROJECT-REF.supabase.co';
  service_role_key text := 'YOUR_SERVICE_ROLE_KEY';
  payload          jsonb;
begin
  payload := jsonb_build_object(
    'to',      new.customer_phone,
    'message', format(
      'Thanks for your order! Total: %s XOF. Ref: %s',
      new.total_xof,
      substring(new.id::text, 1, 8)
    )
  );

  perform extensions.http_post(
    url     := project_url || '/functions/v1/send-sms',
    body    := payload,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || service_role_key
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

-- ── Trigger ─────────────────────────────────────────────────────────────────

drop trigger if exists trg_orders_send_sms on public.orders;
create trigger trg_orders_send_sms
  after insert on public.orders
  for each row
  execute function public.notify_order_created();

comment on function public.notify_order_created() is
  'Fires the `send-sms` Edge Function asynchronously after each new order.';
