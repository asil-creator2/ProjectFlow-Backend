create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  created_at timestamptz not null default now()
);

create index projects_owner_created_at_idx
  on public.projects (owner_id, created_at desc, id desc);

alter table public.projects enable row level security;

create policy "Users can read their own projects"
  on public.projects
  for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "Users can create their own projects"
  on public.projects
  for insert
  to authenticated
  with check (auth.uid() = owner_id);