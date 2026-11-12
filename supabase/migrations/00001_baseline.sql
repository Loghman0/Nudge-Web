-- ============================================================
-- NUDGE — Complete Database Setup
-- Paste this entire file into your Supabase SQL editor and run.
-- Safe to run on BOTH a clean project AND an existing Nudge installation.
-- All statements are idempotent: tables, indexes, triggers, enums, and
-- constraints are created only if they don't already exist.
-- ============================================================

-- ---------- Extensions & Enums ------------------------------------------

create extension if not exists "pgcrypto";

do $$ begin
  if not exists (select 1 from pg_type where typname = 'decision_category' and typnamespace = 'public'::regnamespace) then
    create type public.decision_category as enum (
      'food', 'entertainment', 'travel', 'shopping',
      'lifestyle', 'work', 'social', 'other',
      'health', 'career', 'relationships', 'finance', 'hobbies'
    );
  end if;
end $$;
-- Add any values that might be missing from an older installation
do $$ begin
  perform pg_enum.enumlabel from pg_enum join pg_type on pg_type.oid = pg_enum.enumtypid
  where pg_type.typname = 'decision_category' and pg_enum.enumlabel = 'health';
  if not found then alter type public.decision_category add value if not exists 'health'; end if;
exception when others then null; end $$;
alter type public.decision_category add value if not exists 'career';
alter type public.decision_category add value if not exists 'relationships';
alter type public.decision_category add value if not exists 'finance';
alter type public.decision_category add value if not exists 'hobbies';

do $$ begin
  if not exists (select 1 from pg_type where typname = 'decision_status' and typnamespace = 'public'::regnamespace) then
    create type public.decision_status as enum ('open', 'decided', 'reflected', 'abandoned');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'preference_polarity' and typnamespace = 'public'::regnamespace) then
    create type public.preference_polarity as enum ('like', 'dislike', 'neutral');
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_type where typname = 'notification_kind' and typnamespace = 'public'::regnamespace) then
    create type public.notification_kind as enum ('reflection_prompt', 'discover_question', 'digest', 'system');
  end if;
end $$;

-- ---------- Core tables --------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  full_name     text,
  country       text,
  language      text default 'en',
  occupation    text,
  avatar_url    text,
  age           integer check (age is null or (age >= 13 and age <= 120)),
  onboarded_at  timestamptz,
  decision_style text,
  streak_count      integer not null default 0,
  longest_streak    integer not null default 0,
  last_active_date  date,
  streak_freezes    integer not null default 2,
  weekly_goal       integer not null default 3,
  timezone          text not null default 'UTC',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.preference_categories (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  description text,
  sort_order  int  not null default 0
);

create table if not exists public.preferences (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  category_id  uuid references public.preference_categories (id),
  key          text not null,
  value        text,
  polarity     public.preference_polarity not null default 'like',
  strength     real not null default 0.5 check (strength between 0 and 1),
  source       text not null default 'explicit',
  evidence_count int not null default 1,
  last_reinforced_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, key)
);

create index if not exists preferences_user_idx on public.preferences (user_id);
create index if not exists preferences_user_category_idx on public.preferences (user_id, category_id);
create index if not exists preferences_user_strength_idx on public.preferences (user_id, polarity, strength desc);

create table if not exists public.questions (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references public.preference_categories (id),
  kind         text not null default 'this_or_that',
  prompt       text not null,
  option_a     text,
  option_b     text,
  maps_to_key_a text,
  maps_to_key_b text,
  context      jsonb not null default '{}'::jsonb,
  is_onboarding boolean not null default false,
  is_active    boolean not null default true,
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create unique index if not exists questions_prompt_key on public.questions (prompt);

create table if not exists public.question_answers (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete cascade,
  answer      text not null,
  skipped     boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, question_id)
);

create index if not exists question_answers_user_idx on public.question_answers (user_id);
create index if not exists question_answers_user_created_idx on public.question_answers (user_id, created_at desc);

create table if not exists public.decisions (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade,
  category      public.decision_category not null default 'other',
  question      text not null,
  context       jsonb not null default '{}'::jsonb,
  status        public.decision_status not null default 'open',
  selected_option_id uuid,
  expected_outcome text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists decisions_user_idx on public.decisions (user_id, created_at desc);
create index if not exists decisions_user_category_idx on public.decisions (user_id, category);
create index if not exists decisions_user_status_idx on public.decisions (user_id, status, created_at desc);
create index if not exists decisions_user_created_idx on public.decisions (user_id, created_at desc);
create index if not exists decisions_pending_reflection_idx on public.decisions (decided_at) where status = 'decided';

create table if not exists public.decision_options (
  id          uuid primary key default gen_random_uuid(),
  decision_id uuid not null references public.decisions (id) on delete cascade,
  label       text not null,
  detail      text,
  score       real,
  score_breakdown jsonb not null default '{}'::jsonb,
  rank        int,
  source      text not null default 'engine',
  created_at  timestamptz not null default now()
);

create index if not exists decision_options_decision_idx on public.decision_options (decision_id);

do $$ begin
  alter table public.decisions add constraint decisions_selected_option_fk
  foreign key (selected_option_id) references public.decision_options (id)
  on delete set null;
exception when duplicate_object then null; end $$;

create table if not exists public.decision_reflections (
  id            uuid primary key default gen_random_uuid(),
  decision_id   uuid not null references public.decisions (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  rating        int check (rating between 1 and 5),
  would_repeat  boolean,
  has_regrets   boolean,
  would_recommend boolean,
  would_choose_again boolean,
  notes         text,
  created_at    timestamptz not null default now(),
  unique (decision_id)
);

create index if not exists decision_reflections_user_idx on public.decision_reflections (user_id);

create table if not exists public.ai_memories (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  kind        text not null default 'fact',
  content     text not null,
  confidence  real not null default 0.7 check (confidence between 0 and 1),
  source_decision_id uuid references public.decisions (id) on delete set null,
  expires_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists ai_memories_user_idx on public.ai_memories (user_id);
create index if not exists ai_memories_user_created_idx on public.ai_memories (user_id, created_at desc);

create table if not exists public.analytics_events (
  id         bigint generated always as identity primary key,
  user_id    uuid references public.profiles (id) on delete set null,
  event      text not null,
  properties jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_user_idx on public.analytics_events (user_id, created_at desc);

create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  kind       public.notification_kind not null,
  title      text not null,
  body       text,
  payload    jsonb not null default '{}'::jsonb,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id, created_at desc) where read_at is null;
create index if not exists notifications_reflection_dedupe_idx on public.notifications (user_id, (payload ->> 'decision_id')) where kind = 'reflection_prompt';

-- ---------- Groups & achievements ----------------------------------------

create table if not exists public.decision_groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  invite_code text unique default encode(gen_random_bytes(9), 'hex') not null,
  created_at timestamptz not null default now()
);

create table if not exists public.decision_group_members (
  group_id uuid not null references public.decision_groups (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_polls (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.decision_groups (id) on delete cascade,
  created_by  uuid not null references public.profiles (id) on delete cascade,
  question    text not null check (char_length(question) between 1 and 200),
  status      text not null default 'open' check (status in ('open', 'closed')),
  created_at  timestamptz not null default now()
);

create table if not exists public.group_poll_options (
  id       uuid primary key default gen_random_uuid(),
  poll_id  uuid not null references public.group_polls (id) on delete cascade,
  label    text not null check (char_length(label) between 1 and 100),
  sort_order int not null default 0
);

create table if not exists public.group_poll_votes (
  poll_id   uuid not null references public.group_polls (id) on delete cascade,
  option_id uuid not null references public.group_poll_options (id) on delete cascade,
  user_id   uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (poll_id, user_id)
);

create index if not exists group_polls_group_idx on public.group_polls (group_id, created_at desc);
create index if not exists group_poll_options_poll_idx on public.group_poll_options (poll_id);

create table if not exists public.achievements (
  slug text primary key,
  title text not null,
  description text not null,
  icon text not null,
  sort_order integer not null default 0
);

create table if not exists public.user_achievements (
  user_id uuid not null references public.profiles (id) on delete cascade,
  achievement_slug text not null references public.achievements (slug) on delete cascade,
  earned_at timestamptz not null default now(),
  primary key (user_id, achievement_slug)
);

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- ---------- Engine config -------------------------------------------------

create table if not exists public.decision_engine_configs (
  id uuid primary key default gen_random_uuid(),
  category text not null default 'default',
  version integer not null default 1 check (version > 0),
  weights jsonb not null default '{"preferenceMatch":0.55,"historySuccess":0.30,"novelty":0.15}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (category, version),
  check (jsonb_typeof(weights) = 'object')
);

create unique index if not exists decision_engine_one_active_config on public.decision_engine_configs (category) where is_active;

-- ---------- Knowledge graph -----------------------------------------------

create table if not exists public.knowledge_nodes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  key text not null check (key ~ '^[a-z0-9]+([._-][a-z0-9]+)*$'),
  value text,
  category_slug text not null default 'other',
  kind text not null default 'preference' check (kind in ('preference','habit','goal','value','constraint','interest','avoidance','decision_style')),
  polarity public.preference_polarity not null default 'neutral',
  belief_score real not null default 0 check (belief_score between -1 and 1),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  evidence_count integer not null default 0 check (evidence_count >= 0),
  support_weight real not null default 0 check (support_weight >= 0),
  opposition_weight real not null default 0 check (opposition_weight >= 0),
  source text not null default 'inferred' check (source in ('explicit','inferred','reflected','ai_extracted','imported')),
  last_reinforced_at timestamptz not null default now(),
  last_verified_at timestamptz,
  last_decay_at timestamptz not null default now(),
  verification_due_at timestamptz,
  decay_rate real not null default 0.008 check (decay_rate between 0 and 0.1),
  status text not null default 'active' check (status in ('active','archived','forgotten')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, key)
);

create index if not exists knowledge_nodes_user_category_idx on public.knowledge_nodes (user_id, category_slug, confidence desc) where status = 'active';
create index if not exists knowledge_nodes_verification_idx on public.knowledge_nodes (user_id, verification_due_at) where status = 'active';
create index if not exists knowledge_nodes_decay_idx on public.knowledge_nodes (last_reinforced_at) where status = 'active';

create table if not exists public.knowledge_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  from_node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  to_node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  relation text not null check (relation in ('supports','contradicts','contextualizes','depends_on','avoids')),
  confidence real not null default 0.5 check (confidence between 0 and 1),
  source text not null default 'inferred',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_node_id <> to_node_id),
  unique (from_node_id, to_node_id, relation)
);

create index if not exists knowledge_edges_user_idx on public.knowledge_edges (user_id, from_node_id);

create table if not exists public.knowledge_evidence (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  kind text not null check (kind in ('onboarding_answer','discover_answer','decision','reflection','confirmation','ai_extraction','manual','migration')),
  direction smallint not null check (direction in (-1, 1)),
  weight real not null check (weight > 0 and weight <= 1),
  source_decision_id uuid references public.decisions(id) on delete set null,
  source_question_id uuid references public.questions(id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists knowledge_evidence_node_idx on public.knowledge_evidence (node_id, created_at desc);
create index if not exists knowledge_evidence_user_idx on public.knowledge_evidence (user_id, created_at desc);

create table if not exists public.knowledge_verification_queue (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  node_id uuid not null references public.knowledge_nodes(id) on delete cascade,
  prompt text not null,
  status text not null default 'pending' check (status in ('pending','answered','dismissed','expired')),
  created_at timestamptz not null default now(),
  answered_at timestamptz
);

create index if not exists knowledge_verification_pending_idx on public.knowledge_verification_queue (user_id, created_at desc) where status = 'pending';
create unique index if not exists knowledge_verification_one_pending_idx on public.knowledge_verification_queue (user_id, node_id) where status = 'pending';

-- ---------- RLS ----------------------------------------------------------

alter table public.profiles              enable row level security;
alter table public.preference_categories enable row level security;
alter table public.preferences           enable row level security;
alter table public.questions             enable row level security;
alter table public.question_answers      enable row level security;
alter table public.decisions             enable row level security;
alter table public.decision_options      enable row level security;
alter table public.decision_reflections  enable row level security;
alter table public.ai_memories           enable row level security;
alter table public.analytics_events      enable row level security;
alter table public.notifications         enable row level security;
alter table public.decision_groups       enable row level security;
alter table public.decision_group_members enable row level security;
alter table public.group_polls           enable row level security;
alter table public.group_poll_options    enable row level security;
alter table public.group_poll_votes      enable row level security;
alter table public.achievements          enable row level security;
alter table public.user_achievements     enable row level security;
alter table public.push_subscriptions    enable row level security;
alter table public.decision_engine_configs enable row level security;
alter table public.knowledge_nodes       enable row level security;
alter table public.knowledge_edges       enable row level security;
alter table public.knowledge_evidence    enable row level security;
alter table public.knowledge_verification_queue enable row level security;

-- Own-row policies
drop policy if exists "own profile read" on public.profiles;
create policy "own profile read"   on public.profiles for select using (auth.uid() = id);
drop policy if exists "own profile update" on public.profiles;
create policy "own profile update" on public.profiles for update using (auth.uid() = id);
drop policy if exists "read categories" on public.preference_categories;
create policy "read categories"    on public.preference_categories for select to authenticated using (true);
drop policy if exists "read questions" on public.questions;
create policy "read questions"     on public.questions for select to authenticated using (is_active);
drop policy if exists "own prefs" on public.preferences;
create policy "own prefs"          on public.preferences for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own answers" on public.question_answers;
create policy "own answers"        on public.question_answers for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own decisions" on public.decisions;
create policy "own decisions"      on public.decisions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own decision options" on public.decision_options;
create policy "own decision options" on public.decision_options
  for all using (exists (select 1 from public.decisions d where d.id = decision_id and d.user_id = auth.uid()))
  with check (exists (select 1 from public.decisions d where d.id = decision_id and d.user_id = auth.uid()));
drop policy if exists "own reflections" on public.decision_reflections;
create policy "own reflections"    on public.decision_reflections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own memories" on public.ai_memories;
create policy "own memories"       on public.ai_memories for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "own analytics insert" on public.analytics_events;
create policy "own analytics insert" on public.analytics_events for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own analytics read" on public.analytics_events;
create policy "own analytics read"   on public.analytics_events for select using (auth.uid() = user_id);
drop policy if exists "own notifications read" on public.notifications;
create policy "own notifications read"   on public.notifications for select using (auth.uid() = user_id);
drop policy if exists "own notifications insert" on public.notifications;
create policy "own notifications insert" on public.notifications for insert to authenticated with check (auth.uid() = user_id);
drop policy if exists "own notifications update" on public.notifications;
create policy "own notifications update" on public.notifications for update using (auth.uid() = user_id);
drop policy if exists "own notifications delete" on public.notifications;
create policy "own notifications delete" on public.notifications for delete using (auth.uid() = user_id);
drop policy if exists "own push subscriptions" on public.push_subscriptions;
create policy "own push subscriptions"   on public.push_subscriptions for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "authenticated users read engine configs" on public.decision_engine_configs;
create policy "authenticated users read engine configs" on public.decision_engine_configs for select to authenticated using (is_active);
drop policy if exists "read achievements" on public.achievements;
create policy "read achievements"    on public.achievements for select to authenticated using (true);
drop policy if exists "own achievements" on public.user_achievements;
create policy "own achievements"     on public.user_achievements for select using (user_id = auth.uid());
drop policy if exists "earn own achievements" on public.user_achievements;
create policy "earn own achievements" on public.user_achievements for insert with check (user_id = auth.uid());
drop policy if exists "update own achievements" on public.user_achievements;
create policy "update own achievements" on public.user_achievements for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own knowledge nodes" on public.knowledge_nodes;
create policy "own knowledge nodes"  on public.knowledge_nodes for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own knowledge edges" on public.knowledge_edges;
create policy "own knowledge edges"  on public.knowledge_edges for all using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "own knowledge evidence" on public.knowledge_evidence;
create policy "own knowledge evidence" on public.knowledge_evidence for select using (user_id = auth.uid());
drop policy if exists "own knowledge verification queue" on public.knowledge_verification_queue;
create policy "own knowledge verification queue" on public.knowledge_verification_queue for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Circle policies (use helper to avoid recursion)
create or replace function public.is_circle_member(gid uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from decision_group_members where group_id = gid and user_id = auth.uid());
$$;
grant execute on function public.is_circle_member(uuid) to authenticated;

drop policy if exists "group members can read groups" on public.decision_groups;
create policy "group members can read groups" on public.decision_groups for select using (owner_id = auth.uid() or public.is_circle_member(id));
drop policy if exists "owners manage groups" on public.decision_groups;
create policy "owners manage groups"          on public.decision_groups for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists "circle members read roster" on public.decision_group_members;
create policy "circle members read roster"    on public.decision_group_members for select using (public.is_circle_member(group_id));
drop policy if exists "members read membership" on public.decision_group_members;
create policy "members read membership"       on public.decision_group_members for select using (user_id = auth.uid());
drop policy if exists "owners manage membership" on public.decision_group_members;
create policy "owners manage membership"      on public.decision_group_members for all
  using (exists (select 1 from public.decision_groups g where g.id = group_id and g.owner_id = auth.uid()))
  with check (exists (select 1 from public.decision_groups g where g.id = group_id and g.owner_id = auth.uid()));
drop policy if exists "members leave circle" on public.decision_group_members;
create policy "members leave circle"          on public.decision_group_members for delete using (user_id = auth.uid() and role <> 'owner');
drop policy if exists "members read polls" on public.group_polls;
create policy "members read polls"       on public.group_polls for select using (public.is_circle_member(group_id));
drop policy if exists "members create polls" on public.group_polls;
create policy "members create polls"     on public.group_polls for insert with check (public.is_circle_member(group_id) and created_by = auth.uid());
drop policy if exists "creators close polls" on public.group_polls;
create policy "creators close polls"     on public.group_polls for update using (created_by = auth.uid()) with check (created_by = auth.uid());
drop policy if exists "members read poll options" on public.group_poll_options;
create policy "members read poll options" on public.group_poll_options for select using (exists (select 1 from public.group_polls p where p.id = poll_id and public.is_circle_member(p.group_id)));
drop policy if exists "creators add poll options" on public.group_poll_options;
create policy "creators add poll options" on public.group_poll_options for insert with check (exists (select 1 from public.group_polls p where p.id = poll_id and p.created_by = auth.uid()));
drop policy if exists "members read votes" on public.group_poll_votes;
create policy "members read votes"       on public.group_poll_votes for select using (exists (select 1 from public.group_polls p where p.id = poll_id and public.is_circle_member(p.group_id)));
drop policy if exists "members vote" on public.group_poll_votes;
create policy "members vote"             on public.group_poll_votes for all using (user_id = auth.uid()) with check (user_id = auth.uid() and exists (select 1 from public.group_polls p where p.id = poll_id and p.status = 'open' and public.is_circle_member(p.group_id)));

-- ---------- Functions & triggers -----------------------------------------

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at    before update on public.profiles    for each row execute function public.set_updated_at();
drop trigger if exists preferences_updated_at on public.preferences;
create trigger preferences_updated_at before update on public.preferences for each row execute function public.set_updated_at();
drop trigger if exists decisions_updated_at on public.decisions;
create trigger decisions_updated_at   before update on public.decisions   for each row execute function public.set_updated_at();
drop trigger if exists ai_memories_updated_at on public.ai_memories;
create trigger ai_memories_updated_at before update on public.ai_memories for each row execute function public.set_updated_at();
drop trigger if exists knowledge_nodes_updated_at on public.knowledge_nodes;
create trigger knowledge_nodes_updated_at before update on public.knowledge_nodes for each row execute function public.set_updated_at();
drop trigger if exists knowledge_edges_updated_at on public.knowledge_edges;
create trigger knowledge_edges_updated_at before update on public.knowledge_edges for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), new.raw_user_meta_data ->> 'avatar_url')
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.user_today(p_timezone text)
returns date language sql stable as $$
  select (now() at time zone coalesce(
    (select p_timezone where p_timezone in (select name from pg_timezone_names)), 'UTC'
  ))::date;
$$;

create or replace function public.touch_streak()
returns integer language plpgsql security definer set search_path = public as $$
declare
  prof   public.profiles%rowtype;
  today  date;
  gap    integer;
  result integer;
begin
  select * into prof from public.profiles where id = auth.uid();
  if not found then return 0; end if;
  begin
    today := (now() at time zone coalesce(nullif(trim(prof.timezone), ''), 'UTC'))::date;
  exception when others then
    today := current_date;
  end;
  if prof.last_active_date = today then return prof.streak_count; end if;
  gap := case when prof.last_active_date is null then 999 else today - prof.last_active_date end;
  if gap = 1 then result := prof.streak_count + 1;
  elsif gap = 2 and prof.streak_freezes > 0 then
    result := prof.streak_count + 1;
    update public.profiles set streak_freezes = streak_freezes - 1 where id = prof.id;
  elsif gap < 1 then return prof.streak_count;
  else result := 1;
  end if;
  update public.profiles set streak_count = result, longest_streak = greatest(longest_streak, result), last_active_date = today where id = prof.id;
  return result;
end $$;
grant execute on function public.touch_streak() to authenticated;

create or replace function public.refill_streak_freezes()
returns void language sql security definer set search_path = public as $$
  update public.profiles set streak_freezes = least(2, streak_freezes + 1);
$$;

create or replace function public.set_timezone(p_timezone text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return; end if;
  if p_timezone is null or p_timezone !~ '^[A-Za-z0-9/_+\-]{1,64}$' then return; end if;
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then return; end if;
  update public.profiles set timezone = p_timezone where id = auth.uid() and timezone is distinct from p_timezone;
end $$;
grant execute on function public.set_timezone(text) to authenticated;

create or replace function public.join_decision_circle(code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare circle_id uuid;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  select id into circle_id from decision_groups where invite_code = code;
  if circle_id is null then raise exception 'This invitation is no longer valid'; end if;
  insert into decision_group_members (group_id, user_id, role) values (circle_id, auth.uid(), 'member') on conflict (group_id, user_id) do nothing;
  return circle_id;
end $$;
grant execute on function public.join_decision_circle(text) to authenticated;

create or replace function public.circle_members(gid uuid)
returns table (user_id uuid, full_name text, role text, joined_at timestamptz)
language sql security definer set search_path = public stable as $$
  select m.user_id, coalesce(p.full_name, 'Member'), m.role, m.joined_at
  from decision_group_members m join profiles p on p.id = m.user_id
  where m.group_id = gid and public.is_circle_member(gid)
  order by m.joined_at;
$$;
grant execute on function public.circle_members(uuid) to authenticated;

-- Integrity triggers
create or replace function public.assert_selected_option_matches_decision()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.selected_option_id is not null and not exists (
    select 1 from public.decision_options o where o.id = new.selected_option_id and o.decision_id = new.id
  ) then raise exception 'Selected option does not belong to this decision'; end if;
  return new;
end $$;
drop trigger if exists decisions_selected_option_integrity on public.decisions;
create trigger decisions_selected_option_integrity before insert or update of selected_option_id on public.decisions for each row execute function public.assert_selected_option_matches_decision();

create or replace function public.assert_poll_vote_option_matches_poll()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.group_poll_options o where o.id = new.option_id and o.poll_id = new.poll_id) then
    raise exception 'Poll option does not belong to this poll';
  end if;
  return new;
end $$;
drop trigger if exists group_poll_vote_option_integrity on public.group_poll_votes;
create trigger group_poll_vote_option_integrity before insert or update of poll_id, option_id on public.group_poll_votes for each row execute function public.assert_poll_vote_option_matches_poll();

create or replace function public.commit_decision_choice(p_decision_id uuid, p_option_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if not exists (select 1 from public.decision_options o join public.decisions d on d.id = o.decision_id where o.id = p_option_id and d.id = p_decision_id and d.user_id = auth.uid()) then
    raise exception 'Invalid decision option';
  end if;
  update public.decisions set status = 'decided', selected_option_id = p_option_id, decided_at = now()
  where id = p_decision_id and user_id = auth.uid() and status = 'open';
  if not found then raise exception 'Decision is no longer open'; end if;
  perform public.touch_streak();
end $$;
grant execute on function public.commit_decision_choice(uuid,uuid) to authenticated;

-- Knowledge graph functions
create or replace function public.project_knowledge_node_to_preference()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then delete from public.preferences where user_id = old.user_id and key = old.key; return old; end if;
  if new.status = 'forgotten' then delete from public.preferences where user_id = new.user_id and key = new.key; return new; end if;
  insert into public.preferences (user_id, key, value, polarity, strength, source, evidence_count, last_reinforced_at)
  values (new.user_id, new.key, new.value, new.polarity, greatest(0.1, least(1, abs(new.belief_score) * new.confidence)),
    case when new.source in ('explicit','reflected','inferred') then new.source else 'inferred' end,
    greatest(1, new.evidence_count), new.last_reinforced_at)
  on conflict (user_id, key) do update set
    value = excluded.value, polarity = excluded.polarity, strength = excluded.strength,
    source = excluded.source, evidence_count = excluded.evidence_count, last_reinforced_at = excluded.last_reinforced_at;
  return new;
end $$;
drop trigger if exists knowledge_node_projection on public.knowledge_nodes;
create trigger knowledge_node_projection after insert or update or delete on public.knowledge_nodes for each row execute function public.project_knowledge_node_to_preference();

create or replace function public.record_knowledge_signal(
  p_key text, p_value text, p_category_slug text, p_polarity public.preference_polarity,
  p_source text, p_weight real, p_kind text,
  p_source_decision_id uuid default null, p_source_question_id uuid default null,
  p_verified boolean default false, p_detail jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  node_id uuid; support real; opposition real; total real; belief real; next_confidence real; direction smallint;
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  if p_key !~ '^[a-z0-9]+([._-][a-z0-9]+)*$' then raise exception 'Invalid knowledge key'; end if;
  if p_weight is null or p_weight <= 0 or p_weight > 1 then raise exception 'Invalid evidence weight'; end if;
  if p_polarity = 'neutral' then raise exception 'Neutral signals must be resolved before recording'; end if;
  direction := case when p_polarity = 'like' then 1 else -1 end;
  insert into public.knowledge_nodes (user_id, key, value, category_slug, polarity, source, support_weight, opposition_weight, evidence_count, last_reinforced_at, last_verified_at, verification_due_at)
  values (auth.uid(), lower(p_key), nullif(trim(p_value), ''), coalesce(nullif(trim(p_category_slug), ''), 'other'), p_polarity,
    case when p_source in ('explicit','inferred','reflected','ai_extracted','imported') then p_source else 'inferred' end,
    case when direction = 1 then p_weight else 0 end, case when direction = -1 then p_weight else 0 end,
    1, now(), case when p_verified then now() else null end, now() + interval '60 days')
  on conflict (user_id, key) do update set
    value = coalesce(excluded.value, public.knowledge_nodes.value),
    category_slug = coalesce(nullif(excluded.category_slug, ''), public.knowledge_nodes.category_slug),
    source = excluded.source,
    support_weight = public.knowledge_nodes.support_weight + excluded.support_weight,
    opposition_weight = public.knowledge_nodes.opposition_weight + excluded.opposition_weight,
    evidence_count = public.knowledge_nodes.evidence_count + 1, last_reinforced_at = now(),
    last_verified_at = case when p_verified then now() else public.knowledge_nodes.last_verified_at end,
    verification_due_at = case when p_verified then now() + interval '60 days' else public.knowledge_nodes.verification_due_at end,
    status = 'active'
  returning id, support_weight, opposition_weight into node_id, support, opposition;
  total := greatest(support + opposition, 0.0001);
  belief := greatest(-1, least(1, (support - opposition) / total));
  next_confidence := greatest(0.1, least(0.98, 0.30 + 0.35 * (1 - exp(-total)) + 0.30 * abs(belief)));
  update public.knowledge_nodes set belief_score = belief, confidence = next_confidence,
    polarity = case when belief > 0.08 then 'like'::public.preference_polarity when belief < -0.08 then 'dislike'::public.preference_polarity else 'neutral'::public.preference_polarity end
  where id = node_id;
  insert into public.knowledge_evidence (user_id, node_id, kind, direction, weight, source_decision_id, source_question_id, detail)
  values (auth.uid(), node_id,
    case when p_kind in ('onboarding_answer','discover_answer','decision','reflection','confirmation','ai_extraction','manual','migration') then p_kind else 'manual' end,
    direction, p_weight, p_source_decision_id, p_source_question_id, coalesce(p_detail, '{}'::jsonb));
  return node_id;
end $$;
grant execute on function public.record_knowledge_signal(text,text,text,public.preference_polarity,text,real,text,uuid,uuid,boolean,jsonb) to authenticated;

create or replace function public.forget_knowledge_key(p_key text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'You must be signed in'; end if;
  update public.knowledge_nodes set status = 'forgotten' where user_id = auth.uid() and key = lower(p_key);
end $$;
grant execute on function public.forget_knowledge_key(text) to authenticated;

create or replace function public.apply_knowledge_confidence_decay()
returns integer language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  update public.knowledge_nodes
  set confidence = greatest(0.1, confidence * exp(-decay_rate * greatest(1, extract(epoch from (now() - last_decay_at)) / 86400.0))), last_decay_at = now()
  where status = 'active' and last_reinforced_at < now() - interval '30 days' and last_decay_at < now() - interval '1 day';
  get diagnostics affected = row_count;
  return affected;
end $$;

create or replace function public.enqueue_due_knowledge_verifications()
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  insert into public.knowledge_verification_queue (user_id, node_id, prompt)
  select n.user_id, n.id, 'Nudge learned that ' || coalesce(n.value, replace(n.key, '.', ' ')) || '. Does that still feel true?'
  from public.knowledge_nodes n
  where n.status = 'active' and n.confidence < 0.72
    and coalesce(n.verification_due_at, n.last_reinforced_at + interval '60 days') <= now()
    and not exists (select 1 from public.knowledge_verification_queue q where q.user_id = n.user_id and q.node_id = n.id and q.status = 'pending')
  order by n.verification_due_at nulls first limit 500;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

create or replace function public.enqueue_due_reflection_prompts()
returns integer language plpgsql security definer set search_path = public as $$
declare inserted integer;
begin
  with due as (
    select d.id, d.user_id, d.question, o.label as chosen
    from public.decisions d left join public.decision_options o on o.id = d.selected_option_id
    where d.status = 'decided' and d.decided_at is not null
      and d.decided_at < now() - interval '24 hours' and d.decided_at > now() - interval '30 days'
      and not exists (select 1 from public.decision_reflections r where r.decision_id = d.id)
      and not exists (select 1 from public.notifications n where n.user_id = d.user_id and n.kind = 'reflection_prompt' and n.payload ->> 'decision_id' = d.id::text)
    limit 500
  )
  insert into public.notifications (user_id, kind, title, body, payload)
  select due.user_id, 'reflection_prompt', 'How did it go?',
    case when due.chosen is null then 'You decided: ' || due.question else 'You chose ' || due.chosen || '. Was it the right call?' end,
    jsonb_build_object('decision_id', due.id)
  from due;
  get diagnostics inserted = row_count;
  return inserted;
end $$;

grant execute on function public.apply_knowledge_confidence_decay() to service_role;
grant execute on function public.enqueue_due_knowledge_verifications() to service_role;
grant execute on function public.enqueue_due_reflection_prompts() to service_role;
grant execute on function public.refill_streak_freezes() to service_role;

-- Achievement engine
create or replace function public.evaluate_achievements()
returns setof text language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid(); tz text; today date; week_start date; earned text[] := '{}';
  decided_count integer; category_rows record; distinct_categories integer; pref_count integer;
  reflection_count integer; noted_reflections integer; has_regret boolean; answered_count integer;
  best_streak integer; weekly_goal_setting integer; decided_this_week integer; decided_last_7d integer;
  has_early boolean; has_late boolean; owns_circle boolean; started_poll boolean;
begin
  if uid is null then return; end if;
  select coalesce(nullif(trim(p.timezone), ''), 'UTC'), p.longest_streak, p.weekly_goal
    into tz, best_streak, weekly_goal_setting from public.profiles p where p.id = uid;
  if tz is null then return; end if;
  if not exists (select 1 from pg_timezone_names where name = tz) then tz := 'UTC'; end if;
  today := (now() at time zone tz)::date;
  week_start := date_trunc('week', today::timestamp)::date;
  select count(*) into decided_count from public.decisions where user_id = uid and status in ('decided', 'reflected');
  if decided_count >= 1 then earned := array_append(earned, 'first-decision'); end if;
  for category_rows in select category::text as cat, count(*) as n from public.decisions where user_id = uid and status in ('decided', 'reflected') group by category loop
    if category_rows.cat = 'food'          and category_rows.n >= 5 then earned := array_append(earned, 'foodie'); end if;
    if category_rows.cat = 'entertainment' and category_rows.n >= 5 then earned := array_append(earned, 'movie-expert'); end if;
    if category_rows.cat = 'travel'        and category_rows.n >= 5 then earned := array_append(earned, 'traveller'); end if;
    if category_rows.cat = 'shopping'      and category_rows.n >= 5 then earned := array_append(earned, 'spender'); end if;
  end loop;
  select count(distinct category) into distinct_categories from public.decisions where user_id = uid and status in ('decided', 'reflected');
  if distinct_categories >= 5 then earned := array_append(earned, 'balanced'); end if;
  select count(*) into decided_last_7d from public.decisions where user_id = uid and decided_at >= now() - interval '7 days';
  if decided_last_7d >= 10 then earned := array_append(earned, 'decisive'); end if;
  select count(*) into pref_count from public.preferences where user_id = uid;
  if pref_count >= 10 then earned := array_append(earned, 'explorer'); end if;
  select count(*), count(*) filter (where notes is not null and length(trim(notes)) > 0), bool_or(has_regrets is true)
    into reflection_count, noted_reflections, has_regret from public.decision_reflections where user_id = uid;
  if reflection_count >= 5   then earned := array_append(earned, 'reflective');   end if;
  if noted_reflections >= 10 then earned := array_append(earned, 'deep-thinker'); end if;
  if has_regret              then earned := array_append(earned, 'honest');        end if;
  select count(*) into answered_count from public.question_answers where user_id = uid and skipped = false;
  if answered_count >= 25  then earned := array_append(earned, 'curious');    end if;
  if answered_count >= 100 then earned := array_append(earned, 'well-known'); end if;
  if coalesce(best_streak, 0) >= 7  then earned := array_append(earned, 'week-streak');  end if;
  if coalesce(best_streak, 0) >= 30 then earned := array_append(earned, 'month-streak'); end if;
  select count(*) into decided_this_week from public.decisions where user_id = uid and decided_at is not null and (decided_at at time zone tz)::date >= week_start;
  if coalesce(weekly_goal_setting, 0) > 0 and decided_this_week >= weekly_goal_setting then earned := array_append(earned, 'goal-hit'); end if;
  select bool_or(extract(hour from decided_at at time zone tz) between 4 and 7), bool_or(extract(hour from decided_at at time zone tz) < 4)
    into has_early, has_late from public.decisions where user_id = uid and decided_at is not null;
  if has_early then earned := array_append(earned, 'early-bird'); end if;
  if has_late  then earned := array_append(earned, 'night-owl');  end if;
  select exists (select 1 from public.decision_groups where owner_id = uid) into owns_circle;
  if owns_circle then earned := array_append(earned, 'circle-founder'); end if;
  select exists (select 1 from public.group_polls where created_by = uid) into started_poll;
  if started_poll then earned := array_append(earned, 'poll-starter'); end if;
  return query with granted as (
    insert into public.user_achievements (user_id, achievement_slug)
    select uid, s.slug from unnest(earned) as s(slug)
    where exists (select 1 from public.achievements a where a.slug = s.slug)
    on conflict (user_id, achievement_slug) do nothing returning achievement_slug
  ) select achievement_slug from granted;
end $$;
grant execute on function public.evaluate_achievements() to authenticated;

create or replace function public.next_unanswered_question()
returns setof public.questions language sql stable security definer set search_path = public as $$
  select q.* from public.questions q
  where q.is_active and auth.uid() is not null
    and not exists (select 1 from public.question_answers a where a.user_id = auth.uid() and a.question_id = q.id)
  order by q.sort_order, q.created_at limit 1;
$$;
grant execute on function public.next_unanswered_question() to authenticated;

create or replace function public.question_progress()
returns table (total_questions integer, total_answered integer, answered_today integer)
language plpgsql stable security definer set search_path = public as $$
declare uid uuid := auth.uid(); tz text;
begin
  if uid is null then return query select 0, 0, 0; return; end if;
  select coalesce(nullif(trim(p.timezone), ''), 'UTC') into tz from public.profiles p where p.id = uid;
  if tz is null or not exists (select 1 from pg_timezone_names where name = tz) then tz := 'UTC'; end if;
  return query select
    (select count(*)::integer from public.questions q where q.is_active),
    (select count(*)::integer from public.question_answers a where a.user_id = uid),
    (select count(*)::integer from public.question_answers a where a.user_id = uid and (a.created_at at time zone tz)::date = (now() at time zone tz)::date);
end $$;
grant execute on function public.question_progress() to authenticated;

-- Scheduled jobs (requires pg_cron extension)
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.unschedule(jobid) from cron.job where jobname in ('nudge-checkins','nudge-freeze-refill','nudge-knowledge-decay','nudge-knowledge-verification');
    perform cron.schedule('nudge-checkins',                '0 * * * *',  $j$select public.enqueue_due_reflection_prompts();$j$);
    perform cron.schedule('nudge-freeze-refill',           '0 4 * * 1',  $j$select public.refill_streak_freezes();$j$);
    perform cron.schedule('nudge-knowledge-decay',         '15 3 * * *', $j$select public.apply_knowledge_confidence_decay();$j$);
    perform cron.schedule('nudge-knowledge-verification',  '30 3 * * *', $j$select public.enqueue_due_knowledge_verifications();$j$);
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;

-- ---------- Seed data: categories, achievements, engine config -----------

insert into public.preference_categories (slug, label, description, sort_order) values
  ('food',          'Food & drink',     'Cuisine, drinks, and dining preferences', 1),
  ('entertainment', 'Movies & shows',   'Films, series, music, and books', 2),
  ('travel',        'Travel',           'Destinations and travel style', 3),
  ('shopping',      'Shopping',         'Retail habits and product preferences', 4),
  ('lifestyle',     'Lifestyle',        'Daily habits and personal style', 5),
  ('health',        'Health',           'Health, fitness, and wellbeing', 6),
  ('career',        'Career',           'Career, work, and professional growth', 7),
  ('relationships', 'Relationships',    'Family, friends, and social life', 8),
  ('finance',       'Finance',          'Money, spending, and financial decisions', 9),
  ('hobbies',       'Hobbies',          'Creative interests and leisure', 10)
on conflict (slug) do update set label = excluded.label, description = excluded.description, sort_order = excluded.sort_order;

insert into public.achievements (slug, title, description, icon, sort_order) values
  ('first-decision',  'First nudge',        'Saved your first decision.',                      'Sparkles',    1),
  ('reflective',      'Reflective',         'Completed five decision reflections.',             'Heart',       2),
  ('explorer',        'Explorer',           'Built ten preferences.',                           'Compass',     3),
  ('foodie',          'Foodie',             'Made five food decisions.',                        'Utensils',    4),
  ('movie-expert',    'Movie expert',       'Made five entertainment decisions.',               'Film',        5),
  ('week-streak',     'Seven days',         'Kept a seven-day decision streak.',                'Flame',       6),
  ('month-streak',    'Thirty days',        'Kept a thirty-day decision streak.',               'Trophy',      7),
  ('goal-hit',        'Goal met',           'Hit your weekly decision goal.',                   'Target',      8),
  ('curious',         'Curious',            'Answered twenty-five discovery questions.',        'Compass',     9),
  ('well-known',      'Well known',         'Answered one hundred discovery questions.',        'BookOpen',   10),
  ('deep-thinker',    'Deep thinker',       'Wrote notes on ten reflections.',                  'PenLine',    11),
  ('honest',          'Honest with self',   'Recorded a decision you regretted.',               'HeartCrack', 12),
  ('decisive',        'Decisive',           'Made ten decisions in a single week.',             'Zap',        13),
  ('circle-founder',  'Circle founder',     'Created a decision circle.',                       'UsersRound', 14),
  ('poll-starter',    'Poll starter',       'Opened a group vote.',                             'Vote',       15),
  ('traveller',       'Traveller',          'Made five travel decisions.',                      'Plane',      16),
  ('spender',         'Considered buyer',   'Made five shopping decisions.',                    'ShoppingBag',17),
  ('balanced',        'Balanced',           'Made decisions in five different categories.',     'Scale',      18),
  ('early-bird',      'Early bird',         'Decided something before 8am.',                    'Sunrise',    19),
  ('night-owl',       'Night owl',          'Decided something after midnight.',                'Moon',       20)
on conflict (slug) do update set title = excluded.title, description = excluded.description, icon = excluded.icon, sort_order = excluded.sort_order;

insert into public.decision_engine_configs (category, version, weights)
values ('default', 1, '{"preferenceMatch":0.55,"historySuccess":0.30,"novelty":0.15}'::jsonb)
on conflict (category, version) do update set weights = excluded.weights, is_active = true;

-- ---------- Question bank (500+ questions, 10 categories, interleaved) ----
-- Safe to re-run: matched on prompt, duplicates silently ignored.

insert into public.questions (kind, prompt, option_a, option_b, maps_to_key_a, maps_to_key_b, sort_order) values

-- ═══════════════════════════════════════════════════════════════
-- FOOD & DRINK (80 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Coffee or tea?','Coffee','Tea','drink.coffee','drink.tea',10),
('this_or_that','Pizza or pasta?','Pizza','Pasta','food.pizza','food.pasta',20),
('this_or_that','Sushi or ramen?','Sushi','Ramen','food.sushi','food.ramen',30),
('this_or_that','Burger or sandwich?','Burger','Sandwich','food.burger','food.sandwich',40),
('this_or_that','Spicy or mild?','Spicy','Mild','taste.spicy','taste.mild',50),
('this_or_that','Sweet or savoury?','Sweet','Savoury','taste.sweet','taste.savoury',60),
('this_or_that','Cook tonight or order in?','Cook','Order in','rhythm.cooking','rhythm.delivery',70),
('this_or_that','Steak or fish?','Steak','Fish','food.steak','food.fish',80),
('this_or_that','Rice or bread?','Rice','Bread','food.rice','food.bread',90),
('this_or_that','Soup or salad?','Soup','Salad','food.soup','food.salad',100),
('this_or_that','Italian or Japanese food?','Italian','Japanese','cuisine.italian','cuisine.japanese',110),
('this_or_that','Mexican or Indian food?','Mexican','Indian','cuisine.mexican','cuisine.indian',120),
('this_or_that','Chinese or Thai food?','Chinese','Thai','cuisine.chinese','cuisine.thai',130),
('this_or_that','Korean or Vietnamese food?','Korean','Vietnamese','cuisine.korean','cuisine.vietnamese',140),
('this_or_that','Greek or Lebanese food?','Greek','Lebanese','cuisine.greek','cuisine.lebanese',150),
('this_or_that','Street food or sit-down restaurant?','Street food','Sit-down','food.street','food.restaurant',160),
('this_or_that','A new restaurant or your usual place?','Somewhere new','My usual','style.novelty','style.familiar',170),
('this_or_that','Chocolate or fruit?','Chocolate','Fruit','food.chocolate','food.fruit',180),
('this_or_that','Ice cream or cake?','Ice cream','Cake','food.icecream','food.cake',190),
('this_or_that','Wine or beer?','Wine','Beer','drink.wine','drink.beer',200),
('this_or_that','Cocktail or mocktail?','Cocktail','Mocktail','drink.cocktail','drink.alcohol-free',210),
('this_or_that','Espresso or filter coffee?','Espresso','Filter','drink.espresso','drink.filter-coffee',220),
('this_or_that','Black tea or green tea?','Black tea','Green tea','drink.black-tea','drink.green-tea',230),
('this_or_that','Smoothie or fresh juice?','Smoothie','Juice','drink.smoothie','drink.juice',240),
('this_or_that','Meat-free day or meat every day?','Meat-free','Meat','food.vegetarian','food.meat',250),
('this_or_that','Sharing plates or your own dish?','Sharing','My own','social.sharing','social.own-plate',260),
('this_or_that','Fine dining or a hole in the wall?','Fine dining','Hole in the wall','food.fine-dining','food.casual',270),
('this_or_that','Grilled or fried?','Grilled','Fried','food.grilled','food.fried',280),
('this_or_that','Eggs or oats for breakfast?','Eggs','Oats','food.eggs','food.oats',290),
('this_or_that','Brunch or a proper sit-down dinner?','Brunch','Dinner','rhythm.late-meal','rhythm.big-dinner',300),
('this_or_that','Buffet or set menu?','Buffet','Set menu','food.buffet','food.set-menu',310),
('this_or_that','Turkish or French food?','Turkish','French','cuisine.turkish','cuisine.french',320),
('this_or_that','Spanish or Moroccan food?','Spanish','Moroccan','cuisine.spanish','cuisine.moroccan',330),
('this_or_that','Georgian or Azerbaijani food?','Georgian','Azerbaijani','cuisine.georgian','cuisine.azerbaijani',340),
('this_or_that','Ethiopian or Peruvian food?','Ethiopian','Peruvian','cuisine.ethiopian','cuisine.peruvian',350),
('this_or_that','Vegan or vegetarian options?','Vegan','Vegetarian','food.vegan','food.vegetarian',360),
('this_or_that','Cheese board or charcuterie?','Cheese','Charcuterie','food.cheese','food.charcuterie',370),
('this_or_that','Pasta with red sauce or white sauce?','Red sauce','White sauce','food.tomato-sauce','food.cream-sauce',380),
('this_or_that','Sourdough or brioche?','Sourdough','Brioche','food.sourdough','food.brioche',390),
('this_or_that','Dumplings or spring rolls?','Dumplings','Spring rolls','food.dumplings','food.spring-rolls',400),
('this_or_that','Tacos or burritos?','Tacos','Burritos','food.tacos','food.burritos',410),
('this_or_that','Ramen or pho?','Ramen','Pho','food.ramen','food.pho',420),
('this_or_that','Dim sum or hot pot?','Dim sum','Hot pot','food.dim-sum','food.hot-pot',430),
('this_or_that','Hummus or guacamole?','Hummus','Guacamole','food.hummus','food.guacamole',440),
('this_or_that','Kombucha or sparkling water?','Kombucha','Sparkling water','drink.kombucha','drink.sparkling',450),
('this_or_that','Matcha or chai?','Matcha','Chai','drink.matcha','drink.chai',460),
('this_or_that','Cold brew or hot coffee?','Cold brew','Hot coffee','drink.cold-brew','drink.hot-coffee',470),
('this_or_that','Oat milk or almond milk?','Oat milk','Almond milk','food.oat-milk','food.almond-milk',480),
('this_or_that','Home-baked or store-bought?','Home-baked','Store-bought','rhythm.baking','rhythm.convenience',490),
('this_or_that','Big weekly grocery shop or small daily runs?','Weekly shop','Daily runs','style.planner','style.spontaneous',500),
('this_or_that','Meal prep on Sunday or decide each day?','Meal prep','Decide daily','style.planner','style.spontaneous',510),
('this_or_that','Eat at the table or on the sofa?','Table','Sofa','rhythm.formal-meals','rhythm.casual-meals',520),
('this_or_that','Eat alone or with someone?','Alone','With someone','social.solo-dining','social.dining-together',530),
('this_or_that','Breakfast out or breakfast at home?','Out','At home','rhythm.breakfast-out','rhythm.breakfast-home',540),
('this_or_that','Dessert or a second coffee?','Dessert','Coffee','food.dessert','drink.coffee',550),
('this_or_that','Yoghurt or cereal?','Yoghurt','Cereal','food.yoghurt','food.cereal',560),
('this_or_that','Avocado toast or eggs benedict?','Avocado toast','Eggs benedict','food.avocado','food.eggs-benedict',570),
('this_or_that','Pancakes or waffles?','Pancakes','Waffles','food.pancakes','food.waffles',580),
('this_or_that','Dark chocolate or milk chocolate?','Dark','Milk','food.dark-chocolate','food.milk-chocolate',590),
('this_or_that','Tiramisu or cheesecake?','Tiramisu','Cheesecake','food.tiramisu','food.cheesecake',600),
('this_or_that','Baklava or churros?','Baklava','Churros','food.baklava','food.churros',610),
('this_or_that','Chips with salt or chips with seasoning?','Salt','Seasoning','food.plain-chips','food.seasoned-chips',620),
('this_or_that','Crisps or popcorn?','Crisps','Popcorn','food.crisps','food.popcorn',630),
('this_or_that','Soy sauce or fish sauce?','Soy','Fish sauce','taste.soy','taste.umami',640),
('this_or_that','Herbs or spices?','Herbs','Spices','taste.herbs','taste.spices',650),
('this_or_that','Lemon or lime?','Lemon','Lime','taste.lemon','taste.lime',660),
('this_or_that','Garlic or onion?','Garlic','Onion','taste.garlic','taste.onion',670),
('this_or_that','Ketchup or mustard?','Ketchup','Mustard','condiment.ketchup','condiment.mustard',680),
('this_or_that','Mayo or aioli?','Mayo','Aioli','condiment.mayo','condiment.aioli',690),
('this_or_that','Cook a new recipe or stick to a trusted one?','New recipe','Trusted one','style.novelty','style.familiar',700),
('this_or_that','Food court or sit-down at the mall?','Food court','Sit-down','food.food-court','food.restaurant',710),
('this_or_that','Local market or supermarket?','Market','Supermarket','shopping.market','shopping.supermarket',720),
('this_or_that','Chicken or lamb?','Chicken','Lamb','food.chicken','food.lamb',730),
('this_or_that','Pork belly or duck breast?','Pork belly','Duck breast','food.pork','food.duck',740),
('this_or_that','Octopus or prawns?','Octopus','Prawns','food.octopus','food.prawns',750),
('this_or_that','Mushrooms or aubergine?','Mushrooms','Aubergine','food.mushrooms','food.aubergine',760),
('this_or_that','Lentils or chickpeas?','Lentils','Chickpeas','food.lentils','food.chickpeas',770),
('this_or_that','Tofu or tempeh?','Tofu','Tempeh','food.tofu','food.tempeh',780),

-- ═══════════════════════════════════════════════════════════════
-- ENTERTAINMENT & CULTURE (70 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Film or series tonight?','Film','Series','watch.film','watch.series',790),
('this_or_that','Comedy or drama?','Comedy','Drama','genre.comedy','genre.drama',800),
('this_or_that','Thriller or documentary?','Thriller','Documentary','genre.thriller','genre.documentary',810),
('this_or_that','Sci-fi or fantasy?','Sci-fi','Fantasy','genre.scifi','genre.fantasy',820),
('this_or_that','Horror or romance?','Horror','Romance','genre.horror','genre.romance',830),
('this_or_that','Action or slow-burn?','Action','Slow-burn','genre.action','genre.slow-burn',840),
('this_or_that','Animation or live action?','Animation','Live action','watch.animation','watch.live-action',850),
('this_or_that','True crime or nature documentary?','True crime','Nature','genre.true-crime','genre.nature',860),
('this_or_that','Cinema or home?','Cinema','Home','watch.cinema','watch.home',870),
('this_or_that','Binge the whole season or one episode a night?','Binge','One a night','style.immersive','style.paced',880),
('this_or_that','Subtitles or dubbed?','Subtitles','Dubbed','watch.subtitles','watch.dubbed',890),
('this_or_that','Rewatch a favourite or start something new?','Rewatch','Something new','style.familiar','style.novelty',900),
('this_or_that','Book or podcast?','Book','Podcast','media.book','media.podcast',910),
('this_or_that','Fiction or non-fiction?','Fiction','Non-fiction','genre.fiction','genre.nonfiction',920),
('this_or_that','Paper book or e-reader?','Paper','E-reader','media.paper-book','media.ebook',930),
('this_or_that','Audiobook or reading?','Audiobook','Reading','media.audiobook','media.reading',940),
('this_or_that','Podcasts or music while commuting?','Podcasts','Music','media.podcasts','music.listening',950),
('this_or_that','Live concert or festival?','Concert','Festival','music.concerts','music.festivals',960),
('this_or_that','Classical or jazz?','Classical','Jazz','music.classical','music.jazz',970),
('this_or_that','Hip-hop or R&B?','Hip-hop','R&B','music.hip-hop','music.rnb',980),
('this_or_that','Rock or electronic?','Rock','Electronic','music.rock','music.electronic',990),
('this_or_that','Pop or indie?','Pop','Indie','music.pop','music.indie',1000),
('this_or_that','Folk or soul?','Folk','Soul','music.folk','music.soul',1010),
('this_or_that','Vinyl or streaming?','Vinyl','Streaming','music.vinyl','music.streaming',1020),
('this_or_that','Museum or gallery?','Museum','Gallery','culture.museum','culture.gallery',1030),
('this_or_that','Theatre or stand-up comedy?','Theatre','Stand-up','culture.theatre','culture.standup',1040),
('this_or_that','Opera or ballet?','Opera','Ballet','culture.opera','culture.ballet',1050),
('this_or_that','Photography exhibition or sculpture?','Photography','Sculpture','culture.photography','culture.sculpture',1060),
('this_or_that','Architecture tour or street art walk?','Architecture','Street art','culture.architecture','culture.street-art',1070),
('this_or_that','Historical fiction or contemporary fiction?','Historical','Contemporary','genre.historical-fiction','genre.contemporary',1080),
('this_or_that','Memoir or biography?','Memoir','Biography','genre.memoir','genre.biography',1090),
('this_or_that','Self-help or philosophy?','Self-help','Philosophy','genre.self-help','genre.philosophy',1100),
('this_or_that','Mystery or fantasy novel?','Mystery','Fantasy','genre.mystery','genre.fantasy',1110),
('this_or_that','Short stories or long novels?','Short stories','Long novels','media.short-form','media.long-form',1120),
('this_or_that','Video game or board game?','Video game','Board game','hobby.video-games','hobby.board-games',1130),
('this_or_that','Single-player or multiplayer?','Single-player','Multiplayer','hobby.solo-gaming','hobby.social-gaming',1140),
('this_or_that','Puzzle games or action games?','Puzzle','Action','genre.puzzle-games','genre.action-games',1150),
('this_or_that','RPG or strategy?','RPG','Strategy','genre.rpg','genre.strategy',1160),
('this_or_that','News podcast or storytelling podcast?','News','Storytelling','media.news-podcast','media.story-podcast',1170),
('this_or_that','Long read or quick article?','Long read','Quick article','media.long-read','media.quick-read',1180),
('this_or_that','Documentary series or docufilm?','Series','Film','watch.docu-series','watch.docu-film',1190),
('this_or_that','Cooking show or travel show?','Cooking','Travel','watch.cooking-show','watch.travel-show',1200),
('this_or_that','Reality TV or scripted drama?','Reality','Scripted','watch.reality','watch.scripted',1210),
('this_or_that','Foreign language film or English?','Foreign language','English','watch.foreign','watch.english',1220),
('this_or_that','Award-winning films or crowd favourites?','Award-winning','Crowd favourite','watch.acclaimed','watch.popular',1230),
('this_or_that','Adapt a book or original screenplay?','Book adaptation','Original','watch.adaptation','watch.original',1240),
('this_or_that','Watch with friends or alone?','With friends','Alone','social.group-watch','social.solo-watch',1250),
('this_or_that','Silence your phone or keep it nearby?','Silence it','Keep it nearby','habit.phone-free','habit.connected',1260),
('this_or_that','Dark mode or light mode?','Dark','Light','tech.dark-mode','tech.light-mode',1270),
('this_or_that','Physical media or digital?','Physical','Digital','media.physical','media.digital',1280),
('this_or_that','Early adopter or wait for reviews?','Early adopter','Wait','tech.early-adopter','tech.late-adopter',1290),
('this_or_that','YouTube or TikTok for short videos?','YouTube','TikTok','media.youtube','media.tiktok',1300),
('this_or_that','Twitter/X or Instagram?','Twitter/X','Instagram','social.twitter','social.instagram',1310),
('this_or_that','LinkedIn or Reddit?','LinkedIn','Reddit','social.linkedin','social.reddit',1320),
('this_or_that','WhatsApp or Telegram?','WhatsApp','Telegram','tech.whatsapp','tech.telegram',1330),
('this_or_that','iPhone or Android?','iPhone','Android','tech.ios','tech.android',1340),
('this_or_that','Mac or Windows?','Mac','Windows','tech.mac','tech.windows',1350),
('this_or_that','Wireless earbuds or over-ear headphones?','Earbuds','Over-ear','tech.earbuds','tech.headphones',1360),
('this_or_that','E-bike or regular bike?','E-bike','Regular bike','transport.ebike','transport.bike',1370),
('this_or_that','Smart home gadgets or keep it simple?','Smart home','Keep it simple','tech.smart-home','tech.minimal',1380),
('this_or_that','Wearable fitness tracker or nothing?','Tracker','Nothing','health.tracking','health.intuitive',1390),
('this_or_that','4K monitor or ultrawide?','4K','Ultrawide','tech.4k','tech.ultrawide',1400),
('this_or_that','Console or PC gaming?','Console','PC','hobby.console','hobby.pc-gaming',1410),
('this_or_that','Handheld gaming or TV?','Handheld','TV screen','hobby.handheld','hobby.couch-gaming',1420),
('this_or_that','Collect physical art or digital art?','Physical art','Digital art','creative.physical-art','creative.digital-art',1430),
('this_or_that','Vintage finds or brand new?','Vintage','Brand new','shopping.vintage','shopping.new',1440),
('this_or_that','Minimalist aesthetic or maximalist?','Minimalist','Maximalist','style.minimalist','style.maximalist',1450),
('this_or_that','Loud colour or neutral palette?','Loud colour','Neutral','style.bold-colour','style.neutral',1460),
('this_or_that','Abstract art or representational?','Abstract','Representational','art.abstract','art.representational',1470),
('this_or_that','Photography or video?','Photography','Video','creative.photography','creative.video',1480),

-- ═══════════════════════════════════════════════════════════════
-- TRAVEL (55 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Beach or mountains?','Beach','Mountains','travel.beach','travel.mountains',1490),
('this_or_that','City break or countryside escape?','City','Countryside','travel.city','travel.countryside',1500),
('this_or_that','Europe or Asia?','Europe','Asia','travel.europe','travel.asia',1510),
('this_or_that','Americas or Africa?','Americas','Africa','travel.americas','travel.africa',1520),
('this_or_that','Hot climate or cool climate?','Hot','Cool','travel.hot','travel.cool',1530),
('this_or_that','Summer holiday or winter trip?','Summer','Winter','travel.summer','travel.winter',1540),
('this_or_that','Fly or take the train?','Fly','Train','transport.fly','transport.train',1550),
('this_or_that','Hotel or Airbnb?','Hotel','Airbnb','accommodation.hotel','accommodation.airbnb',1560),
('this_or_that','Boutique hotel or chain hotel?','Boutique','Chain','accommodation.boutique','accommodation.chain',1570),
('this_or_that','Hostel or private room?','Hostel','Private','accommodation.hostel','accommodation.private',1580),
('this_or_that','Tent camping or glamping?','Tent','Glamping','accommodation.camping','accommodation.glamping',1590),
('this_or_that','Adventure travel or relaxation?','Adventure','Relaxation','travel.adventure','travel.relaxation',1600),
('this_or_that','Planned itinerary or go with the flow?','Planned','Spontaneous','style.planner','style.spontaneous',1610),
('this_or_that','Solo travel or with others?','Solo','With others','travel.solo','travel.group',1620),
('this_or_that','Group tour or independent?','Group tour','Independent','travel.guided','travel.independent',1630),
('this_or_that','Backpack or rolling suitcase?','Backpack','Suitcase','travel.backpacker','travel.suitcase',1640),
('this_or_that','Carry-on only or check luggage?','Carry-on only','Check it in','travel.light-packer','travel.heavy-packer',1650),
('this_or_that','Eat where locals eat or top-rated spots?','Local spots','Top-rated','travel.authentic','travel.curated',1660),
('this_or_that','Museums and history or nature and hiking?','Culture','Nature','travel.culture','travel.nature',1670),
('this_or_that','Desert or jungle?','Desert','Jungle','travel.desert','travel.jungle',1680),
('this_or_that','Island hopping or one destination deep?','Island hopping','One place deep','travel.hopping','travel.immersive',1690),
('this_or_that','Cruise or road trip?','Cruise','Road trip','travel.cruise','travel.road-trip',1700),
('this_or_that','Motorcycle trip or sailing?','Motorcycle','Sailing','travel.motorcycle','travel.sailing',1710),
('this_or_that','North or South?','North','South','travel.north','travel.south',1720),
('this_or_that','East or West?','East','West','travel.east','travel.west',1730),
('this_or_that','Ancient ruins or modern architecture?','Ancient','Modern','travel.ancient','travel.modern',1740),
('this_or_that','Night markets or morning markets?','Night markets','Morning markets','travel.night-market','travel.morning-market',1750),
('this_or_that','Local transport or private transfers?','Local transport','Private','travel.public-transport','travel.private',1760),
('this_or_that','Travel for food or travel for art?','Food','Art','travel.food-travel','travel.art-travel',1770),
('this_or_that','New country every trip or revisit favourites?','New country','Revisit','travel.explorer','travel.returner',1780),
('this_or_that','Sunrise hike or sunset cruise?','Sunrise hike','Sunset cruise','travel.sunrise','travel.sunset',1790),
('this_or_that','Remote village or capital city?','Village','Capital','travel.rural','travel.urban',1800),
('this_or_that','Warm ocean or cold lake?','Warm ocean','Cold lake','travel.ocean','travel.lake',1810),
('this_or_that','Ski resort or surf spot?','Ski resort','Surf spot','travel.skiing','travel.surfing',1820),
('this_or_that','Safari or whale watching?','Safari','Whale watching','travel.safari','travel.marine',1830),
('this_or_that','National park or theme park?','National park','Theme park','travel.nature','travel.amusement',1840),
('this_or_that','Budget airline or full-service?','Budget','Full-service','transport.budget-airline','transport.full-service',1850),
('this_or_that','Window or aisle seat?','Window','Aisle','travel.window-seat','travel.aisle-seat',1860),
('this_or_that','Travel insurance always or take the risk?','Always','Take the risk','travel.cautious','travel.risk-taker',1870),
('this_or_that','Travel journal or phone photos?','Journal','Photos','travel.journaler','travel.photographer',1880),
('this_or_that','Buy souvenirs or buy experiences?','Souvenirs','Experiences','travel.collector','travel.experience',1890),
('this_or_that','Short breaks throughout the year or one long holiday?','Short breaks','One long holiday','travel.frequent','travel.deep',1900),
('this_or_that','Long-haul or short-haul?','Long-haul','Short-haul','travel.long-haul','travel.short-haul',1910),
('this_or_that','Learn a few words of the local language or English everywhere?','Learn local','English only','travel.language-learner','travel.english-speaker',1920),
('this_or_that','Street market or department store abroad?','Street market','Department store','travel.street-market','travel.department-store',1930),
('this_or_that','Packed schedule or lazy days?','Packed','Lazy days','travel.packed','travel.slow',1940),
('this_or_that','Waterfalls or volcanoes?','Waterfalls','Volcanoes','travel.waterfalls','travel.volcanoes',1950),
('this_or_that','Arctic or tropics?','Arctic','Tropics','travel.arctic','travel.tropics',1960),
('this_or_that','Cycling tour or cooking class abroad?','Cycling tour','Cooking class','travel.cycling','travel.culinary',1970),
('this_or_that','Photography walk or language exchange?','Photography walk','Language exchange','travel.photographer','travel.language-learner',1980),
('this_or_that','Visit friends abroad or meet strangers?','Visit friends','Meet strangers','travel.friend-visit','travel.social',1990),
('this_or_that','Night train or budget flight?','Night train','Budget flight','transport.night-train','transport.budget-airline',2000),
('this_or_that','Festival abroad or local festival?','Festival abroad','Local festival','travel.festival','culture.local-festival',2010),
('this_or_that','Digital nomad trip or pure holiday?','Work and travel','Pure holiday','travel.digital-nomad','travel.vacation',2020),
('this_or_that','Travel with a guide book or navigate solo?','Guide book','Navigate solo','travel.guide-book','travel.winging-it',2030),

-- ═══════════════════════════════════════════════════════════════
-- LIFESTYLE & DAILY HABITS (60 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Morning person or night owl?','Morning','Night','rhythm.morning','rhythm.night',2040),
('this_or_that','Early alarm or snooze?','Early alarm','Snooze','habit.early-riser','habit.snoozer',2050),
('this_or_that','Routine or variety?','Routine','Variety','style.routine','style.variety',2060),
('this_or_that','Minimalist home or cosy and full?','Minimalist','Cosy and full','home.minimalist','home.cosy',2070),
('this_or_that','City living or suburban?','City','Suburban','home.city','home.suburban',2080),
('this_or_that','Apartment or house?','Apartment','House','home.apartment','home.house',2090),
('this_or_that','Own a pet or no pets?','Yes to pets','No pets','lifestyle.pet-owner','lifestyle.pet-free',2100),
('this_or_that','Dog or cat?','Dog','Cat','pet.dog','pet.cat',2110),
('this_or_that','Car or public transport?','Car','Public transport','transport.car','transport.public',2120),
('this_or_that','Bike or walk?','Bike','Walk','transport.bike','transport.walk',2130),
('this_or_that','Gym or home workout?','Gym','Home','fitness.gym','fitness.home',2140),
('this_or_that','Run outside or treadmill?','Outside','Treadmill','fitness.outdoor-run','fitness.treadmill',2150),
('this_or_that','Yoga or pilates?','Yoga','Pilates','fitness.yoga','fitness.pilates',2160),
('this_or_that','Weights or bodyweight?','Weights','Bodyweight','fitness.weights','fitness.bodyweight',2170),
('this_or_that','Work out alone or with someone?','Alone','With someone','fitness.solo','fitness.partner',2180),
('this_or_that','To-do list or go from memory?','List','Memory','habit.list-maker','habit.memory',2190),
('this_or_that','Paper planner or digital calendar?','Paper','Digital','habit.paper','habit.digital',2200),
('this_or_that','One priority a day or many tasks?','One priority','Many tasks','habit.focus','habit.multi-task',2210),
('this_or_that','Plan the week on Sunday or improvise?','Plan Sunday','Improvise','style.planner','style.spontaneous',2220),
('this_or_that','Declutter regularly or deal with it later?','Declutter','Deal with it later','habit.tidy','habit.accumulate',2230),
('this_or_that','Journaling or meditating?','Journaling','Meditating','habit.journaling','habit.meditation',2240),
('this_or_that','Cold shower or hot shower?','Cold','Hot','health.cold-shower','health.hot-shower',2250),
('this_or_that','Bath or shower?','Bath','Shower','habit.bath','habit.shower',2260),
('this_or_that','Morning coffee before anything or after breakfast?','Before anything','After breakfast','habit.coffee-first','habit.food-first',2270),
('this_or_that','Read the news or avoid it?','Read it','Avoid it','habit.news-reader','habit.news-avoider',2280),
('this_or_that','Social media scrolling or screen-free mornings?','Scroll','Screen-free','habit.social-scroll','habit.screen-free',2290),
('this_or_that','Inbox zero or let it pile up?','Inbox zero','Let it pile','habit.inbox-zero','habit.inbox-piler',2300),
('this_or_that','Respond to messages immediately or in batches?','Immediately','Batches','habit.immediate-reply','habit.batch-reply',2310),
('this_or_that','Cash or card?','Cash','Card','habit.cash','habit.card',2320),
('this_or_that','Buy local or online?','Local','Online','habit.local','habit.online',2330),
('this_or_that','Walk meetings or sit-down meetings?','Walk','Sit-down','work.walk-meeting','work.sit-meeting',2340),
('this_or_that','Notes on paper or on phone?','Paper','Phone','habit.paper-notes','habit.digital-notes',2350),
('this_or_that','Listen to music while working or silence?','Music','Silence','work.music','work.silence',2360),
('this_or_that','Standing desk or sitting?','Standing','Sitting','work.standing-desk','work.sitting',2370),
('this_or_that','Natural light or artificial light?','Natural','Artificial','home.natural-light','home.artificial-light',2380),
('this_or_that','Plants everywhere or minimal greenery?','Lots of plants','Minimal','home.plants','home.minimal-plants',2390),
('this_or_that','Tidy desk or creative chaos?','Tidy','Creative chaos','habit.tidy','habit.chaos',2400),
('this_or_that','Make your bed every day or not?','Every day','Not always','habit.bed-maker','habit.bed-skipper',2410),
('this_or_that','Sleep 7–8 hours or whatever comes naturally?','7–8 hours','Whatever comes','sleep.disciplined','sleep.natural',2420),
('this_or_that','Blackout curtains or let in the morning light?','Blackout','Morning light','sleep.dark','sleep.light',2430),
('this_or_that','Screen off an hour before bed or right until sleep?','Screen off early','Right until sleep','habit.digital-curfew','habit.late-screen',2440),
('this_or_that','Nap when tired or push through?','Nap','Push through','sleep.napper','sleep.no-naps',2450),
('this_or_that','Candles and soft light or bright room?','Candles','Bright room','home.ambient','home.bright',2460),
('this_or_that','Own a lot of clothes or a small curated wardrobe?','Lots','Small wardrobe','style.maximalist-wardrobe','style.capsule-wardrobe',2470),
('this_or_that','Casual style or smart casual?','Casual','Smart casual','style.casual','style.smart-casual',2480),
('this_or_that','Trainers or leather shoes?','Trainers','Leather shoes','style.trainers','style.dress-shoes',2490),
('this_or_that','Branded or unbranded?','Branded','Unbranded','style.branded','style.unbranded',2500),
('this_or_that','Fragrance every day or natural?','Fragrance','Natural','habit.fragrance','habit.unscented',2510),
('this_or_that','Spend time with many people or a few close ones?','Many','Few close','social.wide-circle','social.close-circle',2520),
('this_or_that','Recharge alone or recharge with people?','Alone','With people','personality.introvert','personality.extrovert',2530),
('this_or_that','New experiences or tried-and-tested?','New','Tried-and-tested','personality.novelty-seeker','personality.comfort-keeper',2540),
('this_or_that','Risk taker or safety first?','Risk taker','Safety first','personality.risk-taker','personality.cautious',2550),
('this_or_that','Spontaneous or deliberate?','Spontaneous','Deliberate','personality.spontaneous','personality.deliberate',2560),
('this_or_that','Plan B ready or deal with it if it happens?','Plan B ready','Deal with it','personality.prepared','personality.improviser',2570),
('this_or_that','Competitive or collaborative?','Competitive','Collaborative','personality.competitive','personality.collaborative',2580),
('this_or_that','Leader or contributor?','Lead','Contribute','personality.leader','personality.contributor',2590),
('this_or_that','Speak first or listen first?','Speak first','Listen first','personality.talker','personality.listener',2600),
('this_or_that','Optimist or realist?','Optimist','Realist','personality.optimist','personality.realist',2610),
('this_or_that','Perfectionist or good enough?','Perfectionist','Good enough','personality.perfectionist','personality.pragmatist',2620),

-- ═══════════════════════════════════════════════════════════════
-- HEALTH & FITNESS (55 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Morning workout or evening workout?','Morning','Evening','fitness.morning','fitness.evening',2630),
('this_or_that','Gym or outdoors?','Gym','Outdoors','fitness.gym','fitness.outdoors',2640),
('this_or_that','Running or swimming?','Running','Swimming','fitness.running','fitness.swimming',2650),
('this_or_that','Weights or cardio?','Weights','Cardio','fitness.strength','fitness.cardio',2660),
('this_or_that','Team sport or solo training?','Team sport','Solo','fitness.team','fitness.solo',2670),
('this_or_that','Early night or lie-in?','Early night','Lie-in','sleep.early','sleep.late',2680),
('this_or_that','Track your health with apps or go by feel?','Track it','By feel','health.tracking','health.intuitive',2690),
('this_or_that','Cold exposure or heat therapy?','Cold','Heat','health.cold-exposure','health.heat-therapy',2700),
('this_or_that','Stretch daily or only when sore?','Daily','When sore','health.mobility','health.reactive',2710),
('this_or_that','Walk it off or rest it out?','Walk','Rest','health.active-recovery','health.full-rest',2720),
('this_or_that','Cycling or rowing?','Cycling','Rowing','fitness.cycling','fitness.rowing',2730),
('this_or_that','HIIT or steady-state cardio?','HIIT','Steady-state','fitness.hiit','fitness.steady-cardio',2740),
('this_or_that','Pilates or strength training?','Pilates','Strength','fitness.pilates','fitness.strength',2750),
('this_or_that','Boxing or martial arts?','Boxing','Martial arts','fitness.boxing','fitness.martial-arts',2760),
('this_or_that','Dance class or yoga?','Dance','Yoga','fitness.dance','fitness.yoga',2770),
('this_or_that','Football or tennis?','Football','Tennis','sport.football','sport.tennis',2780),
('this_or_that','Basketball or volleyball?','Basketball','Volleyball','sport.basketball','sport.volleyball',2790),
('this_or_that','Skiing or snowboarding?','Skiing','Snowboarding','sport.skiing','sport.snowboarding',2800),
('this_or_that','Surfing or paddleboarding?','Surfing','Paddleboarding','sport.surfing','sport.paddleboarding',2810),
('this_or_that','Rock climbing or hiking?','Rock climbing','Hiking','sport.climbing','sport.hiking',2820),
('this_or_that','Protein shake or whole food recovery?','Shake','Whole food','nutrition.shake','nutrition.whole-food',2830),
('this_or_that','Intermittent fasting or three meals a day?','Fasting','Three meals','nutrition.fasting','nutrition.regular-meals',2840),
('this_or_that','Plant-based diet or omnivore?','Plant-based','Omnivore','nutrition.plant-based','nutrition.omnivore',2850),
('this_or_that','Meal prep or eat fresh?','Meal prep','Eat fresh','nutrition.meal-prep','nutrition.fresh',2860),
('this_or_that','Count calories or eat intuitively?','Count','Intuitive','nutrition.counting','nutrition.intuitive',2870),
('this_or_that','Sleep tracker or trust how you feel?','Sleep tracker','Trust your body','health.sleep-tracking','health.body-wisdom',2880),
('this_or_that','Regular check-ups or only when unwell?','Regular','Only if needed','health.preventive','health.reactive-care',2890),
('this_or_that','Therapy or self-help books?','Therapy','Books','health.therapy','health.self-help',2900),
('this_or_that','Talk to someone or process alone?','Talk to someone','Process alone','health.talk-through','health.self-process',2910),
('this_or_that','Supplements or food first?','Supplements','Food first','nutrition.supplements','nutrition.food-first',2920),
('this_or_that','Hydration tracking or drink when thirsty?','Track it','When thirsty','health.hydration-tracking','health.intuitive-hydration',2930),
('this_or_that','Saunas or cold plunge pools?','Sauna','Cold plunge','health.sauna','health.cold-plunge',2940),
('this_or_that','Massage or acupuncture?','Massage','Acupuncture','health.massage','health.acupuncture',2950),
('this_or_that','Breathwork or guided meditation?','Breathwork','Guided meditation','health.breathwork','health.guided-meditation',2960),
('this_or_that','Journaling for mental health or exercise?','Journaling','Exercise','health.journaling','health.exercise-mood',2970),
('this_or_that','Nature walk or gym session for stress?','Nature walk','Gym session','health.nature','health.gym-stress',2980),
('this_or_that','Sleep 8 hours or optimise with shorter?','8 hours','Optimise shorter','sleep.full-night','sleep.optimised',2990),
('this_or_that','Phone-free hour before bed or habits as usual?','Phone-free','As usual','sleep.wind-down','sleep.no-routine',3000),
('this_or_that','Blue light glasses or just limit screens?','Glasses','Limit screens','health.blue-light-glasses','health.screen-limits',3010),
('this_or_that','Stand up every hour or when you feel like it?','Every hour','When I feel like it','health.structured-breaks','health.unstructured-breaks',3020),
('this_or_that','Walk or cycle to work?','Walk','Cycle','transport.walk','transport.bike',3030),
('this_or_that','30 minutes of movement or longer sessions less often?','30 min daily','Long sessions','fitness.daily-short','fitness.long-infrequent',3040),
('this_or_that','Group fitness class or personal training?','Group class','Personal training','fitness.group-class','fitness.pt',3050),
('this_or_that','Track personal records or train by feel?','Track records','By feel','fitness.tracking','fitness.feel',3060),
('this_or_that','Rest day or active recovery?','Full rest','Active recovery','fitness.rest-day','fitness.active-recovery',3070),
('this_or_that','Warm up properly or get straight into it?','Warm up','Get into it','fitness.warm-up','fitness.no-warmup',3080),
('this_or_that','Compete or train for yourself?','Compete','Myself','fitness.competitive','fitness.self-driven',3090),
('this_or_that','Sport for fun or sport for fitness?','Fun','Fitness','fitness.fun','fitness.performance',3100),
('this_or_that','Train through minor pain or stop and recover?','Train through','Stop and recover','fitness.push-through','fitness.recovery-first',3110),
('this_or_that','Music while running or no headphones?','Music','No headphones','fitness.music-run','fitness.silent-run',3120),
('this_or_that','Park run or race events?','Park run','Races','fitness.parkrun','fitness.racing',3130),
('this_or_that','Mountain biking or road cycling?','Mountain','Road','sport.mountain-bike','sport.road-cycling',3140),
('this_or_that','Golf or tennis?','Golf','Tennis','sport.golf','sport.tennis',3150),
('this_or_that','Cricket or rugby?','Cricket','Rugby','sport.cricket','sport.rugby',3160),
('this_or_that','Athletics or swimming competitions?','Athletics','Swimming','sport.athletics','sport.competitive-swimming',3170),

-- ═══════════════════════════════════════════════════════════════
-- CAREER & LEARNING (55 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Deep work blocks or quick task sprints?','Deep blocks','Quick sprints','career.deep-work','career.sprints',3180),
('this_or_that','Specialist or generalist?','Specialist','Generalist','career.specialist','career.generalist',3190),
('this_or_that','Lead the project or master the craft?','Lead','Craft','career.leadership','career.craft',3200),
('this_or_that','Stable role or startup energy?','Stable','Startup','career.stability','career.risk',3210),
('this_or_that','Learn by course or learn by doing?','Course','Doing','learning.structured','learning.hands-on',3220),
('this_or_that','Books or videos to learn something new?','Books','Videos','learning.reading','learning.video',3230),
('this_or_that','Feedback straight up or softened?','Straight up','Softened','career.direct-feedback','career.gentle-feedback',3240),
('this_or_that','Office days or remote days?','Office','Remote','career.office','career.remote',3250),
('this_or_that','One big goal or many small ones?','One big','Many small','career.moonshot','career.increments',3260),
('this_or_that','Mentor others or be mentored?','Mentor','Be mentored','career.mentoring','career.learning',3270),
('this_or_that','Morning productivity or afternoon?','Morning','Afternoon','career.morning-peak','career.afternoon-peak',3280),
('this_or_that','Work in a team or independently?','Team','Independently','career.team-work','career.independent',3290),
('this_or_that','Creative work or analytical work?','Creative','Analytical','career.creative','career.analytical',3300),
('this_or_that','People-facing or behind-the-scenes?','People-facing','Behind scenes','career.people-facing','career.behind-scenes',3310),
('this_or_that','Build something new or optimise what exists?','Build new','Optimise','career.builder','career.optimiser',3320),
('this_or_that','Big company or small company?','Big','Small','career.big-company','career.small-company',3330),
('this_or_that','High salary or interesting work?','High salary','Interesting work','career.compensation','career.fulfillment',3340),
('this_or_that','Work to live or live to work?','Work to live','Live to work','career.work-life','career.work-passion',3350),
('this_or_that','Climb the ladder or go your own way?','Climb','Own way','career.corporate','career.entrepreneur',3360),
('this_or_that','Freelance or employed?','Freelance','Employed','career.freelance','career.employed',3370),
('this_or_that','Meetings or async communication?','Meetings','Async','work.meetings','work.async',3380),
('this_or_that','Presentation or written report?','Presentation','Written','work.presentation','work.written',3390),
('this_or_that','Brainstorm in a group or alone first?','Group','Alone first','work.group-brainstorm','work.solo-brainstorm',3400),
('this_or_that','Data-driven or gut instinct?','Data','Gut','career.data-driven','career.intuitive',3410),
('this_or_that','Consistent pace or sprint and rest?','Consistent','Sprint and rest','career.consistent','career.sprinter',3420),
('this_or_that','Detailed plan or broad direction?','Detailed','Broad direction','career.planner','career.visionary',3430),
('this_or_that','Learn from failure or study success?','Failure','Success','learning.failure','learning.success',3440),
('this_or_that','Certification or portfolio?','Certification','Portfolio','learning.certification','learning.portfolio',3450),
('this_or_that','University degree or self-taught?','Degree','Self-taught','learning.degree','learning.self-taught',3460),
('this_or_that','Read broadly or go deep in one area?','Broadly','Deep','learning.breadth','learning.depth',3470),
('this_or_that','Take notes or remember it?','Notes','Remember','learning.notes','learning.memory',3480),
('this_or_that','Teach someone else to learn better?','Teach','Self-study','learning.teaching','learning.self-study',3490),
('this_or_that','Flashcards or mind maps?','Flashcards','Mind maps','learning.flashcards','learning.mind-maps',3500),
('this_or_that','Morning reading or evening reading?','Morning','Evening','learning.morning-read','learning.evening-read',3510),
('this_or_that','Industry events or online communities?','Events','Online','career.networking-events','career.online-communities',3520),
('this_or_that','Cold outreach or warm introductions?','Cold','Warm intro','career.cold-outreach','career.warm-intro',3530),
('this_or_that','Build in public or work quietly?','Build in public','Work quietly','career.public','career.private',3540),
('this_or_that','Side project or full focus at work?','Side project','Full focus','career.side-project','career.focus',3550),
('this_or_that','Product thinking or engineering thinking?','Product','Engineering','career.product','career.engineering',3560),
('this_or_that','Execution or strategy?','Execution','Strategy','career.executor','career.strategist',3570),
('this_or_that','Slow and right or fast and iterate?','Slow and right','Fast and iterate','career.quality','career.speed',3580),
('this_or_that','Feedback weekly or quarterly reviews?','Weekly','Quarterly','career.frequent-feedback','career.quarterly-review',3590),
('this_or_that','Salary raise or more responsibility?','Raise','Responsibility','career.compensation','career.growth',3600),
('this_or_that','Sabbatical or continuous momentum?','Sabbatical','Momentum','career.sabbatical','career.continuous',3610),
('this_or_that','Attend conferences or read the papers?','Conferences','Papers','learning.conference','learning.research',3620),
('this_or_that','Teach a skill or learn a new one?','Teach','Learn new','career.teach','career.learn-new',3630),
('this_or_that','Podcast for learning or book?','Podcast','Book','learning.podcast','learning.book',3640),
('this_or_that','Trial and error or structured approach?','Trial and error','Structured','learning.trial-error','learning.structured',3650),
('this_or_that','Cross-functional role or deep domain?','Cross-functional','Deep domain','career.cross-functional','career.domain-expert',3660),
('this_or_that','Internal promotion or external opportunity?','Internal','External','career.internal','career.external',3670),
('this_or_that','Work from a café or dedicated office?','Café','Office','work.cafe','work.office',3680),
('this_or_that','4-day work week or standard 5?','4 days','5 days','work.4-day-week','work.5-day-week',3690),
('this_or_that','Flexible hours or fixed hours?','Flexible','Fixed','work.flexible','work.fixed-hours',3700),
('this_or_that','Job security or high upside?','Security','Upside','career.security','career.upside',3710),
('this_or_that','Colleagues as friends or keep it professional?','Friends','Professional','career.friendly','career.professional',3720),

-- ═══════════════════════════════════════════════════════════════
-- MONEY & FINANCE (45 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Save first or spend first?','Save first','Spend first','finance.saver','finance.spender',3730),
('this_or_that','Budget every month or keep a rough eye?','Budget it','Rough eye','finance.budgeter','finance.relaxed',3740),
('this_or_that','Invest or keep it safe?','Invest','Keep safe','invest.growth','invest.security',3750),
('this_or_that','Pay more for quality or hunt for deals?','Quality','Deals','finance.quality','finance.bargains',3760),
('this_or_that','Split the bill or take turns paying?','Split','Take turns','finance.split','finance.turns',3770),
('this_or_that','Experiences or possessions?','Experiences','Possessions','finance.experiences','finance.things',3780),
('this_or_that','Big purchase: sleep on it or trust the moment?','Sleep on it','Trust the moment','finance.deliberate','finance.decisive',3790),
('this_or_that','Cash cushion or put money to work?','Cushion','Put it to work','finance.buffer','invest.deployed',3800),
('this_or_that','Index funds or pick individual stocks?','Index funds','Pick stocks','invest.passive','invest.active',3810),
('this_or_that','Pay off debt or invest simultaneously?','Debt first','Invest alongside','finance.debt-first','finance.parallel',3820),
('this_or_that','Multiple income streams or one main source?','Multiple','One main','finance.diversified-income','finance.single-income',3830),
('this_or_that','Frugal and free early or spend and work longer?','Frugal and free','Spend and work','finance.fire','finance.lifestyle',3840),
('this_or_that','Automate savings or manually transfer?','Automate','Manual','finance.automated','finance.manual',3850),
('this_or_that','Track every spend or rough awareness?','Track every spend','Rough idea','finance.detailed-tracking','finance.awareness',3860),
('this_or_that','Rent or buy property?','Rent','Buy','property.rent','property.buy',3870),
('this_or_that','New car or reliable used car?','New','Used','finance.new-car','finance.used-car',3880),
('this_or_that','Lease or own?','Lease','Own','finance.lease','finance.own',3890),
('this_or_that','Pay bills early or on the due date?','Early','Due date','finance.early-pay','finance.on-time',3900),
('this_or_that','Subscriptions or pay-per-use?','Subscriptions','Pay per use','finance.subscriptions','finance.pay-per-use',3910),
('this_or_that','Buy premium apps or use free versions?','Premium','Free','finance.premium-apps','finance.free-apps',3920),
('this_or_that','Support local businesses or choose the cheapest?','Local','Cheapest','finance.local-support','finance.price-first',3930),
('this_or_that','Pre-plan your tax or sort it last minute?','Pre-plan','Last minute','finance.tax-planning','finance.tax-reactive',3940),
('this_or_that','Stocks and shares ISA or pension first?','ISA','Pension','invest.isa','invest.pension',3950),
('this_or_that','Crypto or traditional assets?','Crypto','Traditional','invest.crypto','invest.traditional',3960),
('this_or_that','Property or equities?','Property','Equities','invest.property','invest.equities',3970),
('this_or_that','Gold or cash as a hedge?','Gold','Cash','invest.gold','invest.cash',3980),
('this_or_that','Charity giving monthly or one-off?','Monthly','One-off','finance.monthly-giving','finance.ad-hoc-giving',3990),
('this_or_that','Generous gift giver or practical?','Generous','Practical','finance.generous','finance.practical-gifts',4000),
('this_or_that','Round up savings apps or separate savings account?','Round-up apps','Separate account','finance.round-up','finance.savings-account',4010),
('this_or_that','Bank with a big bank or challenger bank?','Big bank','Challenger','finance.big-bank','finance.challenger-bank',4020),
('this_or_that','Contactless or chip and PIN?','Contactless','Chip and PIN','finance.contactless','finance.chip-pin',4030),
('this_or_that','Financial advisor or DIY investing?','Advisor','DIY','finance.advisor','finance.diy',4040),
('this_or_that','FIRE movement or conventional retirement?','FIRE','Conventional','finance.fire','finance.conventional-retirement',4050),
('this_or_that','Side hustle or overtime?','Side hustle','Overtime','finance.side-hustle','finance.overtime',4060),
('this_or_that','Spend on travel or spend on home?','Travel','Home','finance.travel-spend','finance.home-spend',4070),
('this_or_that','Negotiate prices or accept what is listed?','Negotiate','Accept it','finance.negotiator','finance.price-taker',4080),
('this_or_that','Second-hand electronics or new?','Second-hand','New','finance.secondhand-tech','finance.new-tech',4090),
('this_or_that','Invest in yourself or in the market?','Yourself','Market','finance.self-invest','invest.market',4100),
('this_or_that','Emergency fund first or invest first?','Emergency fund','Invest first','finance.emergency-first','invest.early',4110),
('this_or_that','Annual review of finances or monthly?','Annual','Monthly','finance.annual-review','finance.monthly-review',4120),
('this_or_that','Financial goals written down or kept in mind?','Written down','In mind','finance.written-goals','finance.mental-goals',4130),
('this_or_that','Talk openly about money or keep it private?','Openly','Private','finance.open','finance.private',4140),
('this_or_that','Own business one day or employee?','Own business','Employee','finance.entrepreneur','finance.employee',4150),
('this_or_that','Value invest or growth invest?','Value','Growth','invest.value','invest.growth-stocks',4160),
('this_or_that','Short-term savings or long-term wealth?','Short-term','Long-term','finance.short-term','finance.long-term',4170),

-- ═══════════════════════════════════════════════════════════════
-- RELATIONSHIPS & SOCIAL LIFE (45 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Big group or a few close friends?','Big group','Few close','social.big-groups','social.close-circle',4180),
('this_or_that','Call or text?','Call','Text','social.calls','social.texts',4190),
('this_or_that','Host the gathering or be the guest?','Host','Guest','social.hosting','social.guesting',4200),
('this_or_that','Deep one-on-ones or lively group energy?','One-on-ones','Group energy','social.deep-talks','social.group-energy',4210),
('this_or_that','Resolve conflict right away or cool off first?','Right away','Cool off','relationship.address-now','relationship.cool-off',4220),
('this_or_that','Surprise plans or plans agreed together?','Surprise','Agreed','relationship.surprises','relationship.co-planned',4230),
('this_or_that','Keep in touch daily or less but meaningful?','Daily','Meaningful and less','social.daily-contact','social.meaningful-contact',4240),
('this_or_that','Say yes to plans or protect your time?','Say yes','Protect time','social.yes-person','social.boundary-setter',4250),
('this_or_that','Introduce friends from different circles or keep them separate?','Mix them','Keep separate','social.mixer','social.separator',4260),
('this_or_that','Share feelings easily or keep things in?','Share easily','Keep in','personality.open','personality.private',4270),
('this_or_that','Apologies quickly or stand your ground?','Apologise quickly','Stand ground','relationship.apologiser','relationship.assertive',4280),
('this_or_that','Give advice or just listen?','Give advice','Just listen','social.advisor','social.listener',4290),
('this_or_that','Stay friends with exes or move on cleanly?','Stay friends','Move on','relationship.friends-after','relationship.clean-break',4300),
('this_or_that','Long-term relationship or enjoy being single?','Long-term','Single life','relationship.partner-focus','relationship.independent',4310),
('this_or_that','Partners who share your interests or complement you?','Same interests','Complement','relationship.shared-interests','relationship.opposites',4320),
('this_or_that','Date nights out or stay-in evenings?','Date nights out','Stay in','relationship.date-nights','relationship.cosy-in',4330),
('this_or_that','Space in a relationship or always together?','Space','Always together','relationship.space','relationship.together',4340),
('this_or_that','Celebrate birthdays big or keep it quiet?','Big','Quiet','social.big-birthdays','social.quiet-birthdays',4350),
('this_or_that','Gifts that show thought or practical gifts?','Thoughtful','Practical','social.thoughtful-gifts','social.practical-gifts',4360),
('this_or_that','Write a heartfelt card or send a voice note?','Card','Voice note','social.card','social.voice-note',4370),
('this_or_that','Family dinner weekly or spontaneous meet-ups?','Weekly','Spontaneous','family.weekly-dinner','family.spontaneous',4380),
('this_or_that','Close relationship with family or friends are your family?','Family first','Friends as family','social.family-close','social.friends-family',4390),
('this_or_that','Long-distance friendships or invest in who is near?','Long-distance','Nearby','social.long-distance','social.local-friends',4400),
('this_or_that','Meet people at events or through mutual friends?','Events','Mutual friends','social.events','social.referrals',4410),
('this_or_that','Online communities or in-person ones?','Online','In-person','social.online-community','social.local-community',4420),
('this_or_that','Trust quickly or take time?','Trust quickly','Take time','personality.quick-trust','personality.slow-trust',4430),
('this_or_that','Forgive and forget or remember and learn?','Forgive and forget','Remember and learn','personality.forgiver','personality.learner',4440),
('this_or_that','Set boundaries early or work it out as you go?','Early','As you go','relationship.early-boundaries','relationship.evolving',4450),
('this_or_that','Express love through words or actions?','Words','Actions','relationship.words-of-affirmation','relationship.acts-of-service',4460),
('this_or_that','Vent to friends or process alone?','Vent','Alone','social.venter','social.processor',4470),
('this_or_that','Ask for help or figure it out yourself?','Ask for help','Myself','personality.helper-asker','personality.independent',4480),
('this_or_that','Network actively or let connections happen naturally?','Actively','Naturally','social.active-networker','social.passive',4490),
('this_or_that','Have a mentor or learn from peers?','Mentor','Peers','career.mentor','career.peer-learning',4500),
('this_or_that','Socialise to energise or socialise out of obligation?','Energising','Obligation','social.energising','social.obligatory',4510),
('this_or_that','People who challenge you or people who support you?','Challenge','Support','social.challengers','social.supporters',4520),
('this_or_that','Spend holidays with family or friends?','Family','Friends','social.holiday-family','social.holiday-friends',4530),
('this_or_that','Formal occasions or casual get-togethers?','Formal','Casual','social.formal','social.casual',4540),
('this_or_that','Make new friends easily or invest deeply in few?','Easily','Few deep','social.friendly','social.deep-connector',4550),
('this_or_that','Be the advice giver or the decision maker?','Advice giver','Decision maker','social.advisor','social.decider',4560),
('this_or_that','Say what you mean directly or hint?','Direct','Hint','personality.direct','personality.indirect',4570),
('this_or_that','Honest but harsh or kind but vague?','Honest but harsh','Kind but vague','personality.blunt','personality.diplomatic',4580),
('this_or_that','Prioritise a partner or personal growth?','Partner','Growth','relationship.partner-first','relationship.growth-first',4590),
('this_or_that','Consistent support or grand gestures?','Consistent','Grand gestures','relationship.consistent','relationship.grand',4600),
('this_or_that','Plan a future together early or go with the flow?','Plan early','Go with flow','relationship.planner','relationship.flow',4610),
('this_or_that','Public displays of affection or private?','Public','Private','relationship.pda','relationship.private-affection',4620),

-- ═══════════════════════════════════════════════════════════════
-- SHOPPING & POSSESSIONS (40 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Online shopping or in-store?','Online','In-store','shopping.online','shopping.in-store',4630),
('this_or_that','Research for days or buy and move on?','Research','Buy and move on','shopping.researcher','shopping.quick',4640),
('this_or_that','Brand loyalty or whatever is best today?','Loyal','Best today','brand.loyal','brand.agnostic',4650),
('this_or_that','New or second-hand?','New','Second-hand','shopping.new','shopping.second-hand',4660),
('this_or_that','Wardrobe basics or statement pieces?','Basics','Statement','shopping.basics','shopping.statement',4670),
('this_or_that','Latest tech or wait a generation?','Latest','Wait','shopping.early-adopter','shopping.late-adopter',4680),
('this_or_that','Gift cards or picked-out presents?','Gift cards','Picked out','shopping.gift-cards','shopping.thoughtful-gifts',4690),
('this_or_that','Fast fashion or slow fashion?','Fast fashion','Slow fashion','shopping.fast-fashion','shopping.slow-fashion',4700),
('this_or_that','Capsule wardrobe or varied collection?','Capsule','Varied','style.capsule-wardrobe','style.varied-wardrobe',4710),
('this_or_that','Designer or high-street?','Designer','High-street','shopping.designer','shopping.highstreet',4720),
('this_or_that','Buy less, spend more or buy more at lower cost?','Less but better','More at lower cost','shopping.quality','shopping.volume',4730),
('this_or_that','Impulse buy or think it through?','Impulse','Think first','shopping.impulse','shopping.deliberate',4740),
('this_or_that','Subscription boxes or buy individually?','Subscription','Individual','shopping.subscription-box','shopping.individual',4750),
('this_or_that','Rent clothes or buy?','Rent','Buy','shopping.rental','shopping.purchase',4760),
('this_or_that','Ethical brands or price first?','Ethical','Price first','shopping.ethical','shopping.price-first',4770),
('this_or_that','Pre-loved items or brand new?','Pre-loved','Brand new','shopping.preloved','shopping.brand-new',4780),
('this_or_that','Physical bookshop or Amazon?','Physical bookshop','Amazon','shopping.local-bookshop','shopping.amazon',4790),
('this_or_that','Outlet stores or full price?','Outlet','Full price','shopping.outlet','shopping.full-price',4800),
('this_or_that','End-of-season sales or buy when you need?','Sales','When needed','shopping.sales','shopping.immediate',4810),
('this_or_that','Handmade or mass-produced?','Handmade','Mass-produced','shopping.handmade','shopping.mass-produced',4820),
('this_or_that','Tech gadgets or experiences as gifts?','Gadgets','Experiences','gift.tech','gift.experiences',4830),
('this_or_that','Books or courses as gifts?','Books','Courses','gift.books','gift.courses',4840),
('this_or_that','Meaningful small gift or impressive large one?','Meaningful small','Impressive large','gift.thoughtful','gift.impressive',4850),
('this_or_that','Wrap presents or go minimal?','Wrap it','Minimal','gift.wrapped','gift.minimal',4860),
('this_or_that','Buy art or DIY decoration?','Buy art','DIY','home.art','home.diy-decor',4870),
('this_or_that','Premium kitchen tools or budget basics?','Premium','Budget basics','home.premium-kitchen','home.budget-kitchen',4880),
('this_or_that','Buy furniture assembled or flat-pack?','Assembled','Flat-pack','home.assembled','home.flat-pack',4890),
('this_or_that','Neutral home colours or bold choices?','Neutral','Bold','home.neutral','home.bold-colours',4900),
('this_or_that','Antique furniture or contemporary design?','Antique','Contemporary','home.antique','home.contemporary',4910),
('this_or_that','Own more or own less?','More','Less','home.maximalist','home.minimalist-home',4920),
('this_or_that','Premium headphones or budget ones?','Premium','Budget','tech.premium-headphones','tech.budget-headphones',4930),
('this_or_that','Own a smart speaker or skip it?','Own one','Skip it','tech.smart-speaker','tech.no-smart-speaker',4940),
('this_or_that','Physical wallet or digital wallet?','Physical','Digital','finance.physical-wallet','finance.digital-wallet',4950),
('this_or_that','Buy new or refurbished electronics?','New','Refurbished','tech.new','tech.refurbished',4960),
('this_or_that','Own a car or car-share?','Own','Car-share','transport.own-car','transport.car-share',4970),
('this_or_that','Buy sport kit from brands or own-label?','Brands','Own-label','shopping.sports-brand','shopping.own-label',4980),
('this_or_that','Few high-quality bags or many affordable ones?','Few quality','Many affordable','shopping.quality-bags','shopping.volume-bags',4990),
('this_or_that','Invest in a mattress or basic works?','Invest in it','Basic works','home.premium-mattress','home.budget-mattress',5000),
('this_or_that','Ergonomic office chair or standard?','Ergonomic','Standard','home.ergonomic','home.standard-chair',5010),
('this_or_that','Nice stationery or just get it done?','Nice stationery','Just get it done','shopping.stationery','shopping.functional',5020),

-- ═══════════════════════════════════════════════════════════════
-- HOBBIES & CREATIVITY (50 questions)
-- ═══════════════════════════════════════════════════════════════
('this_or_that','Make things or collect things?','Make','Collect','hobby.maker','hobby.collector',5030),
('this_or_that','Photography or drawing?','Photography','Drawing','creative.photography','creative.drawing',5040),
('this_or_that','Play an instrument or listen to music?','Play','Listen','creative.playing-music','music.listening',5050),
('this_or_that','Gardening or DIY projects?','Gardening','DIY','hobby.gardening','hobby.diy',5060),
('this_or_that','Puzzles or trivia?','Puzzles','Trivia','hobby.puzzles','hobby.trivia',5070),
('this_or_that','Write it down or talk it out?','Write','Talk','creative.writing','social.talking',5080),
('this_or_that','Learn a language or learn an instrument?','Language','Instrument','hobby.languages','creative.instrument',5090),
('this_or_that','Dance or sing?','Dance','Sing','hobby.dancing','hobby.singing',5100),
('this_or_that','Chess or cards?','Chess','Cards','hobby.chess','hobby.cards',5110),
('this_or_that','Pottery or sculpture?','Pottery','Sculpture','creative.pottery','creative.sculpture',5120),
('this_or_that','Knitting or embroidery?','Knitting','Embroidery','creative.knitting','creative.embroidery',5130),
('this_or_that','Painting or illustration?','Painting','Illustration','creative.painting','creative.illustration',5140),
('this_or_that','Watercolour or oil paint?','Watercolour','Oil','creative.watercolour','creative.oil-paint',5150),
('this_or_that','Write fiction or non-fiction?','Fiction','Non-fiction','creative.fiction','creative.nonfiction',5160),
('this_or_that','Short stories or full novel?','Short stories','Novel','creative.short-stories','creative.novel',5170),
('this_or_that','Blog or newsletter?','Blog','Newsletter','creative.blog','creative.newsletter',5180),
('this_or_that','Film-making or photography?','Film-making','Photography','creative.filmmaking','creative.photography',5190),
('this_or_that','Podcast or YouTube channel?','Podcast','YouTube','creative.podcast','creative.youtube',5200),
('this_or_that','Creative writing or journalism?','Creative','Journalism','creative.fiction-writing','creative.journalism',5210),
('this_or_that','Cook for fun or bake for fun?','Cook','Bake','hobby.cooking','hobby.baking',5220),
('this_or_that','Ferment and brew or cook fresh?','Ferment','Cook fresh','hobby.fermentation','hobby.cooking',5230),
('this_or_that','Grow your own food or buy it?','Grow','Buy','hobby.growing','hobby.buying',5240),
('this_or_that','Astronomy or birdwatching?','Astronomy','Birdwatching','hobby.astronomy','hobby.birdwatching',5250),
('this_or_that','Hiking or rock climbing?','Hiking','Rock climbing','hobby.hiking','hobby.climbing',5260),
('this_or_that','Camping or canoeing?','Camping','Canoeing','hobby.camping','hobby.canoeing',5270),
('this_or_that','Cycling or running for recreation?','Cycling','Running','hobby.cycling','hobby.running',5280),
('this_or_that','Fishing or sailing?','Fishing','Sailing','hobby.fishing','hobby.sailing',5290),
('this_or_that','Woodworking or metalworking?','Woodworking','Metalworking','hobby.woodwork','hobby.metalwork',5300),
('this_or_that','3D printing or electronics tinkering?','3D printing','Electronics','hobby.3d-printing','hobby.electronics',5310),
('this_or_that','Coding projects or design projects?','Coding','Design','creative.coding','creative.design',5320),
('this_or_that','App development or web design?','App','Web design','creative.app-dev','creative.web-design',5330),
('this_or_that','Magic or juggling?','Magic','Juggling','hobby.magic','hobby.juggling',5340),
('this_or_that','Improv theatre or scripted performance?','Improv','Scripted','hobby.improv','hobby.scripted-theatre',5350),
('this_or_that','Stand-up comedy or spoken word?','Stand-up','Spoken word','hobby.standup','hobby.spoken-word',5360),
('this_or_that','Join a book club or solo reading?','Book club','Solo','hobby.book-club','hobby.solo-reading',5370),
('this_or_that','Film club or game night?','Film club','Game night','hobby.film-club','hobby.game-night',5380),
('this_or_that','Escape rooms or axe throwing?','Escape room','Axe throwing','hobby.escape-room','hobby.axe-throwing',5390),
('this_or_that','Laser tag or go-karting?','Laser tag','Go-karting','hobby.laser-tag','hobby.go-karting',5400),
('this_or_that','Archery or horse riding?','Archery','Horse riding','hobby.archery','hobby.horse-riding',5410),
('this_or_that','Yoga retreat or silent retreat?','Yoga retreat','Silent retreat','hobby.yoga-retreat','hobby.silent-retreat',5420),
('this_or_that','Volunteering or personal projects?','Volunteering','Personal projects','hobby.volunteering','hobby.personal-projects',5430),
('this_or_that','Cultural club or sports club?','Cultural','Sports','hobby.cultural-club','hobby.sports-club',5440),
('this_or_that','Online course for hobby or local class?','Online','Local class','hobby.online-course','hobby.local-class',5450),
('this_or_that','Compete in your hobby or keep it casual?','Compete','Casual','hobby.competitive','hobby.casual',5460),
('this_or_that','Start a new hobby or deepen a current one?','New hobby','Deepen current','hobby.new','hobby.deepen',5470),
('this_or_that','Minimalist art or expressive art?','Minimalist','Expressive','art.minimalist','art.expressive',5480),
('this_or_that','Street photography or portrait photography?','Street','Portrait','creative.street-photo','creative.portrait-photo',5490),
('this_or_that','Landscape photography or macro photography?','Landscape','Macro','creative.landscape-photo','creative.macro-photo',5500),
('this_or_that','Digital art or traditional art?','Digital','Traditional','creative.digital-art','creative.traditional-art',5510),
('this_or_that','Comic illustration or fine art?','Comic','Fine art','creative.comic-art','creative.fine-art',5520)

on conflict (prompt) do nothing;

-- ═══════════════════════════════════════════════════════════════
-- INTERLEAVE: round-robin across categories so users never see
-- the same topic for 20 questions in a row.
-- ═══════════════════════════════════════════════════════════════
with buckets as (
  select id,
    case
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('food','cuisine','drink','taste','condiment','nutrition') then 'food'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('watch','genre','music','media','culture','art','play','creative') then 'entertainment'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('travel','transport','accommodation','destination') then 'travel'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('shopping','brand','gift','home','property','style','tech') then 'shopping'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('health','sleep','body','fitness','sport') then 'health'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('career','work','learning','skill') then 'career'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('finance','invest','money','budget','spend','save') then 'finance'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('social','relationship','family','people','pet') then 'relationships'
      when split_part(coalesce(maps_to_key_a, maps_to_key_b, 'style.x'), '.', 1)
           in ('hobby') then 'hobbies'
      else 'lifestyle'
    end as bucket,
    sort_order as old_order
  from public.questions
),
ranked as (
  select id, bucket, old_order,
    row_number() over (partition by bucket order by old_order, id) as pos_in_bucket
  from buckets
),
positioned as (
  select id,
    row_number() over (order by pos_in_bucket, bucket, old_order) as new_order
  from ranked
)
update public.questions q
set sort_order = p.new_order
from positioned p
where q.id = p.id
  and q.sort_order is distinct from p.new_order;
