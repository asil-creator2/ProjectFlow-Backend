create table public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index task_subtasks_task_created_at_idx
  on public.task_subtasks (task_id, created_at, id);

alter table public.task_subtasks enable row level security;

create policy "Users can read subtasks on their own tasks"
  on public.task_subtasks
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_subtasks.task_id and p.id = task_subtasks.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can create subtasks on their own tasks"
  on public.task_subtasks
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_subtasks.task_id and p.id = task_subtasks.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can update their own subtasks"
  on public.task_subtasks
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_subtasks.task_id and p.id = task_subtasks.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_subtasks.task_id and p.id = task_subtasks.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can delete their own subtasks"
  on public.task_subtasks
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_subtasks.task_id and p.id = task_subtasks.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );
