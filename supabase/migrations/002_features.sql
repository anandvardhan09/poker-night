-- Poker Night: table options, daily refill, player stats, friends and leaderboard.
-- Run after 001_init.sql in the Supabase SQL editor (or `supabase db push`).

alter table public.profiles add column if not exists last_refill_at timestamptz;
alter table public.tables add column if not exists settings jsonb not null default '{}';
alter table public.hand_history add column if not exists details jsonb not null default '{}';

-- Bots have no profile, so the server never saves their seats or per-player stats.
create table if not exists public.player_hands (
  id bigserial primary key,
  hand_id bigint not null references public.hand_history (id) on delete cascade,
  table_id uuid not null references public.tables (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  net bigint not null,
  vpip boolean not null,
  pfr boolean not null,
  won boolean not null,
  pot_won bigint not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists player_hands_user_idx on public.player_hands (user_id, id desc);

create table if not exists public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

alter table public.player_hands enable row level security;
alter table public.friendships enable row level security;

-- Tops the balance up to p_amount, at most once per interval and only when below it.
create or replace function public.claim_daily_refill(p_user uuid, p_amount bigint, p_interval_seconds integer)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  update public.profiles
     set chip_balance = p_amount,
         last_refill_at = now(),
         updated_at = now()
   where id = p_user
     and chip_balance < p_amount
     and (last_refill_at is null or last_refill_at <= now() - make_interval(secs => p_interval_seconds))
  returning chip_balance into new_balance;

  if new_balance is null then
    raise exception 'REFILL_NOT_AVAILABLE';
  end if;
  return new_balance;
end;
$$;

create or replace function public.leaderboard(p_limit integer, p_users uuid[] default null)
returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  chip_balance bigint,
  hands bigint,
  net bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.display_name, p.avatar_url, p.chip_balance,
         count(ph.id) as hands,
         coalesce(sum(ph.net), 0)::bigint as net
    from public.profiles p
    left join public.player_hands ph on ph.user_id = p.id
   where p_users is null or p.id = any (p_users)
   group by p.id
   order by p.chip_balance desc
   limit p_limit;
$$;

revoke all on function public.claim_daily_refill(uuid, bigint, integer) from public, anon, authenticated;
revoke all on function public.leaderboard(integer, uuid[]) from public, anon, authenticated;
grant execute on function public.claim_daily_refill(uuid, bigint, integer) to service_role;
grant execute on function public.leaderboard(integer, uuid[]) to service_role;
