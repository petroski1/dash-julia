-- Minhas Finanças: tabelas, segurança (RLS) e tempo real.
-- Rode uma vez no SQL Editor do Supabase.

-- Quem pode ver e editar os dados (por e-mail de login).
create table if not exists public.fin_members (
  email text primary key,
  added_at timestamptz not null default now()
);

-- Pessoas, cartões e categorias (uma linha só).
create table if not exists public.fin_settings (
  id int primary key default 1 check (id = 1),
  people jsonb not null default '[]',
  cards jsonb not null default '[]',
  categories jsonb not null default '{}',
  updated_at timestamptz not null default now()
);

create table if not exists public.fin_transactions (
  id text primary key,
  type text not null check (type in ('entrada', 'saida')),
  description text not null,
  amount numeric(12, 2) not null check (amount > 0),
  date date not null,
  category text not null,
  person text not null,
  method text,
  card_id text,
  installments int not null default 1 check (installments between 1 and 48),
  recurring boolean not null default false,
  end_month text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fin_transactions_date_idx on public.fin_transactions (date);

-- É membro? (security definer para não depender do RLS de fin_members)
create or replace function public.fin_is_member()
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.fin_members
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- O primeiro login vira membro automaticamente; depois disso, só quem já é membro adiciona outros.
create or replace function public.fin_join()
returns boolean
language plpgsql security definer set search_path = public
as $$
declare
  me text := lower(coalesce(auth.jwt() ->> 'email', ''));
begin
  if me = '' then return false; end if;
  if not exists (select 1 from public.fin_members) then
    insert into public.fin_members (email) values (me);
  end if;
  return exists (select 1 from public.fin_members where email = me);
end;
$$;

revoke all on function public.fin_is_member() from public, anon;
revoke all on function public.fin_join() from public, anon;
grant execute on function public.fin_is_member() to authenticated;
grant execute on function public.fin_join() to authenticated;

alter table public.fin_members enable row level security;
alter table public.fin_settings enable row level security;
alter table public.fin_transactions enable row level security;

drop policy if exists "membros leem membros" on public.fin_members;
drop policy if exists "membros adicionam membros" on public.fin_members;
drop policy if exists "membros removem membros" on public.fin_members;
create policy "membros leem membros" on public.fin_members
  for select to authenticated using ((select public.fin_is_member()));
create policy "membros adicionam membros" on public.fin_members
  for insert to authenticated with check ((select public.fin_is_member()) and email = lower(email));
create policy "membros removem membros" on public.fin_members
  for delete to authenticated using ((select public.fin_is_member()));

drop policy if exists "membros usam configuracoes" on public.fin_settings;
create policy "membros usam configuracoes" on public.fin_settings
  for all to authenticated
  using ((select public.fin_is_member())) with check ((select public.fin_is_member()));

drop policy if exists "membros usam lancamentos" on public.fin_transactions;
create policy "membros usam lancamentos" on public.fin_transactions
  for all to authenticated
  using ((select public.fin_is_member())) with check ((select public.fin_is_member()));

-- Atualização em tempo real entre aparelhos.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'fin_transactions') then
    alter publication supabase_realtime add table public.fin_transactions;
  end if;
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime' and tablename = 'fin_settings') then
    alter publication supabase_realtime add table public.fin_settings;
  end if;
end $$;
