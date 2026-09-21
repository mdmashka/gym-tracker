create extension if not exists pgcrypto;

create table if not exists public.workout_types (
  id text primary key,
  name text not null,
  slug text not null unique,
  sort_order int not null default 0
);

create table if not exists public.profiles (
  telegram_user_id bigint primary key,
  username text,
  first_name text,
  last_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  telegram_user_id bigint not null references public.profiles(telegram_user_id) on delete cascade,
  workout_type_id text not null references public.workout_types(id),
  name text not null,
  load_type text not null default 'weight' check (load_type in ('weight','assisted','dumbbell','plate','custom')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists exercises_user_client_uq on public.exercises(telegram_user_id, client_id);
create unique index if not exists exercises_user_type_name_uq on public.exercises(telegram_user_id, workout_type_id, lower(name));

create table if not exists public.workouts (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  telegram_user_id bigint not null references public.profiles(telegram_user_id) on delete cascade,
  workout_type_id text not null references public.workout_types(id),
  workout_date date not null,
  status text not null default 'draft' check (status in ('draft','completed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists workouts_user_client_uq on public.workouts(telegram_user_id, client_id);
create index if not exists workouts_user_type_date_idx on public.workouts(telegram_user_id, workout_type_id, workout_date desc);

create table if not exists public.workout_exercises (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  workout_id uuid not null references public.workouts(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id),
  sort_order int not null default 0,
  skipped boolean not null default false,
  notes text
);

create unique index if not exists workout_exercises_user_client_uq on public.workout_exercises(workout_id, client_id);
create unique index if not exists workout_exercises_unique on public.workout_exercises(workout_id, exercise_id);

create table if not exists public.workout_sets (
  id uuid primary key default gen_random_uuid(),
  client_id text not null,
  workout_exercise_id uuid not null references public.workout_exercises(id) on delete cascade,
  set_order int not null,
  weight numeric,
  reps numeric,
  comment text,
  load_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index if not exists workout_sets_client_uq on public.workout_sets(workout_exercise_id, client_id);
create unique index if not exists workout_sets_order_uq on public.workout_sets(workout_exercise_id, set_order);

insert into public.workout_types(id,name,slug,sort_order) values
('legs','Ноги','legs',1),
('arms','Руки','arms',2),
('back_shoulders','Спина + плечи','back_shoulders',3)
on conflict (id) do update set name=excluded.name, slug=excluded.slug, sort_order=excluded.sort_order;
