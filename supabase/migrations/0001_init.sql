-- profiles: mirrors auth.users so client code (admin page) can read emails via RLS
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- single hardcoded admin account, matches the fixed admin@admin.com requirement
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') = 'admin@admin.com';
$$;

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (auth.uid() = id or public.is_admin());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- courses
create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  price integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.courses enable row level security;

create policy "courses_select_all"
  on public.courses for select
  using (true);

-- orders: status only ever moves pending -> paid, and only via the
-- confirm-payment edge function using the service_role key (no update policy
-- is defined here on purpose, so clients can never set their own order to paid).
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid not null references public.courses(id),
  order_id text not null unique,
  amount integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid')),
  payment_key text,
  method text,
  approved_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.orders enable row level security;

create policy "orders_insert_own"
  on public.orders for insert
  with check (auth.uid() = user_id);

create policy "orders_select_own_or_admin"
  on public.orders for select
  using (auth.uid() = user_id or public.is_admin());

insert into public.courses (title, description, price)
values (
  '체형분석운동지도자 교육',
  '근골격계 통증의 원인을 체형 분석으로 찾아 해결하는 운동지도자 과정입니다.',
  300000
)
on conflict do nothing;
