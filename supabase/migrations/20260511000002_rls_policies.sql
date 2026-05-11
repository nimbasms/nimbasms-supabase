-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security for sms_logs
--
-- Rules:
--   * Authenticated users can only see and insert their OWN rows
--     (sms_logs.user_id = auth.uid()).
--   * The service-role key bypasses RLS automatically, so Edge Functions
--     using it can read and write any row (needed for webhook updates and
--     for system-initiated sends with no signed-in user).
-- ────────────────────────────────────────────────────────────────────────────

alter table public.sms_logs enable row level security;

-- SELECT: a user can read rows they own.
drop policy if exists "sms_logs_select_own" on public.sms_logs;
create policy "sms_logs_select_own"
  on public.sms_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

-- INSERT: a user can insert rows under their own user_id.
drop policy if exists "sms_logs_insert_own" on public.sms_logs;
create policy "sms_logs_insert_own"
  on public.sms_logs
  for insert
  to authenticated
  with check (auth.uid() = user_id);

-- UPDATE / DELETE are intentionally NOT granted to authenticated users.
-- Status transitions (sent → delivered / failed) happen via the
-- sms-webhook Edge Function using the service-role key, which bypasses RLS.

revoke all on public.sms_logs from anon;
grant  select, insert on public.sms_logs to authenticated;
