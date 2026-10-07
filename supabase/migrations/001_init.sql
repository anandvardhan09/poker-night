-- Poker Night schema. Run in the Supabase SQL editor (or `supabase db push`).
-- All access goes through the game server using the service role key, so RLS is
-- enabled with no policies: the anon/authenticated roles cannot read or write.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  avatar_url text,
  chip_balance bigint not null default 10000 check (chip_balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tables (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  host_id uuid not null references public.profiles (id) on delete cascade,
  small_blind integer not null check (small_blind > 0),
  big_blind integer not null check (big_blind >= small_blind),
  max_seats integer not null check (max_seats between 2 and 9),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.table_seats (
  table_id uuid not null references public.tables (id) on delete cascade,
  seat_no integer not null,
  user_id uuid not null references public.profiles (id) on delete cascade,
  stack bigint not null check (stack >= 0),
  status text not null check (status in ('active', 'sitting_out', 'disconnected')),
  updated_at timestamptz not null default now(),
  primary key (table_id, seat_no),
  unique (table_id, user_id)
);
create index if not exists table_seats_user_idx on public.table_seats (user_id);

create table if not exists public.table_snapshots (
  table_id uuid primary key references public.tables (id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists public.hand_history (
  id bigserial primary key,
  table_id uuid not null references public.tables (id) on delete cascade,
  hand_no integer not null,
  board jsonb not null default '[]',
  actions jsonb not null default '[]',
  winners jsonb not null default '[]',
  created_at timestamptz not null default now()
);
create index if not exists hand_history_table_idx on public.hand_history (table_id, hand_no desc);

alter table public.profiles enable row level security;
alter table public.tables enable row level security;
alter table public.table_seats enable row level security;
alter table public.table_snapshots enable row level security;
alter table public.hand_history enable row level security;

-- Atomic balance change; raises if the balance would go negative.
create or replace function public.adjust_chip_balance(p_user uuid, p_delta bigint)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  new_balance bigint;
begin
  update public.profiles
     set chip_balance = chip_balance + p_delta,
         updated_at = now()
   where id = p_user
     and chip_balance + p_delta >= 0
  returning chip_balance into new_balance;

  if new_balance is null then
    raise exception 'INSUFFICIENT_CHIPS';
  end if;
  return new_balance;
end;
$$;

revoke all on function public.adjust_chip_balance(uuid, bigint) from public, anon, authenticated;
grant execute on function public.adjust_chip_balance(uuid, bigint) to service_role;
