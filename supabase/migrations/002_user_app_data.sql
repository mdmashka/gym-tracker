create table if not exists public.user_app_data (
  telegram_user_id bigint primary key references public.profiles(telegram_user_id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists user_app_data_updated_idx on public.user_app_data(updated_at desc);

-- The app accesses this table only through the Edge Function using a server secret.
-- RLS remains enabled/denies direct client access; there are intentionally no policies.
alter table public.user_app_data enable row level security;
