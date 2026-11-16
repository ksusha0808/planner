-- Мой планер: таблицы для синхронизации.
-- Вставь целиком в Supabase → SQL Editor → New query → Run.

create table if not exists public.items (
  user_id    uuid    not null default auth.uid() references auth.users on delete cascade,
  id         text    not null,
  kind       text    not null,
  data       jsonb   not null default '{}'::jsonb,
  updated_at bigint  not null,
  deleted    boolean not null default false,
  primary key (user_id, id)
);

alter table public.items enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Секретная ссылка на календарь для виджета телефона
create table if not exists public.feeds (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  token   text unique not null default replace(gen_random_uuid()::text, '-', '')
);

alter table public.feeds enable row level security;

drop policy if exists "own feed read" on public.feeds;
create policy "own feed read" on public.feeds for select using (auth.uid() = user_id);
drop policy if exists "own feed insert" on public.feeds;
create policy "own feed insert" on public.feeds for insert with check (auth.uid() = user_id);
