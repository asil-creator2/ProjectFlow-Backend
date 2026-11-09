create table public.task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  filename text not null check (char_length(btrim(filename)) between 1 and 255),
  content_type text not null check (char_length(btrim(content_type)) between 1 and 255),
  size_bytes integer not null check (size_bytes >= 0),
  storage_url text not null check (char_length(btrim(storage_url)) between 1 and 2048),
  created_at timestamptz not null default now()
);

create index task_attachments_task_created_at_idx
  on public.task_attachments (task_id, created_at, id);

alter table public.task_attachments enable row level security;

create policy "Users can read attachments on their own tasks"
  on public.task_attachments
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_attachments.task_id and p.id = task_attachments.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can create attachments on their own tasks"
  on public.task_attachments
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_attachments.task_id and p.id = task_attachments.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can update their own attachments"
  on public.task_attachments
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_attachments.task_id and p.id = task_attachments.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_attachments.task_id and p.id = task_attachments.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can delete their own attachments"
  on public.task_attachments
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_attachments.task_id and p.id = task_attachments.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );
