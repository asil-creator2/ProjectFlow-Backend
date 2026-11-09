create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  description text check (description is null or char_length(description) <= 2000),
  status text not null default 'todo' check (status in ('todo', 'in_progress', 'done')),
  due_date date,
  created_at timestamptz not null default now()
);

create index tasks_project_created_at_idx
  on public.tasks (project_id, created_at, id);

alter table public.tasks enable row level security;

create policy "Users can read tasks in their own projects"
  on public.tasks
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );

create policy "Users can create tasks in their own projects"
  on public.tasks
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );