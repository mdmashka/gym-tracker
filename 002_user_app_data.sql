create table if not exists public.user_app_data (
  telegram_user_id bigint primary key references public.users(telegram_id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists user_app_data_updated_idx
  on public.user_app_data(updated_at desc);

alter table public.user_app_data enable row level security;

-- No direct public policies. The Mini App talks to the Edge Function,
-- which validates Telegram initData and uses the server-side key.
