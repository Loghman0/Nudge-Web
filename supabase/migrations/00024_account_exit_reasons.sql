-- Aggregate exit feedback: why people pause or delete their Nudge account.
-- Additive only: no existing table, row or policy is changed.
-- Reasons are voluntary feedback, stored without name or email. The user_id
-- link is set to NULL when the account is deleted, so totals survive account
-- deletion while the feedback becomes fully anonymous.
-- NOT APPLIED YET - owner approval required before running in Supabase.
begin;

create table if not exists public.account_exit_reasons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('pause', 'delete')),
  reasons text[] not null default '{}',
  created_at timestamptz not null default now()
);

alter table public.account_exit_reasons enable row level security;

drop policy if exists "insert own exit reasons" on public.account_exit_reasons;
create policy "insert own exit reasons" on public.account_exit_reasons
  for insert to authenticated
  with check (user_id = auth.uid());

-- No select/update/delete policy for authenticated: only the service role
-- (server-side statistics) can read the aggregate rows.

commit;