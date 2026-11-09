create table public.comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index comments_task_created_at_idx
  on public.comments (task_id, created_at, id);

alter table public.comments enable row level security;

create policy "Users can read comments on their own tasks"
  on public.comments
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = comments.task_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can create comments on their own tasks"
  on public.comments
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = comments.task_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can update their own comments"
  on public.comments
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = comments.task_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = comments.task_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can delete their own comments"
  on public.comments
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = comments.task_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );
