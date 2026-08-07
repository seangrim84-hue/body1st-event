-- Point orders.user_id at public.profiles instead of auth.users so PostgREST
-- can embed profiles(email) directly in admin queries (auth.users isn't
-- exposed to the API). profiles.id already has its own FK to auth.users(id),
-- and a profiles row always exists before an order can be inserted (the
-- handle_new_user trigger creates it at signup time).
alter table public.orders
  drop constraint orders_user_id_fkey,
  add constraint orders_user_id_fkey
    foreign key (user_id) references public.profiles(id) on delete cascade;
