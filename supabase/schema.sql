-- Run this once in the Supabase SQL editor (Table Editor is not needed).
-- Anyone with the public anon key can ADD a workout and READ workouts.
-- Nobody with the anon key can change or delete one: there are no update or delete policies.

create table if not exists public.workout_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  date date not null,
  day text not null check (char_length(day) < 100),
  entries jsonb not null default '[]'::jsonb check (jsonb_typeof(entries) = 'array' and char_length(entries::text) < 50000),
  warmup jsonb not null default '[]'::jsonb,
  cooldown jsonb not null default '[]'::jsonb
);

alter table public.workout_logs enable row level security;

create policy "anyone can add a workout"
  on public.workout_logs for insert to anon
  with check (true);

create policy "anyone can read workouts"
  on public.workout_logs for select to anon
  using (true);
