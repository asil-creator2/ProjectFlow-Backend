create table public.task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120),
  completed boolean not null default false,
  created_at timestamptz not null default now()
);

create index task_checklist_items_task_created_at_idx
  on public.task_checklist_items (task_id, created_at, id);

alter table public.task_checklist_items enable row level security;

create policy "Users can read checklist items in their own tasks"
  on public.task_checklist_items
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_checklist_items.task_id and p.id = task_checklist_items.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can create checklist items in their own tasks"
  on public.task_checklist_items
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_checklist_items.task_id and p.id = task_checklist_items.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can update their own checklist items"
  on public.task_checklist_items
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_checklist_items.task_id and p.id = task_checklist_items.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_checklist_items.task_id and p.id = task_checklist_items.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );

create policy "Users can delete their own checklist items"
  on public.task_checklist_items
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.tasks t
      join public.projects p on p.id = t.project_id
      where t.id = task_checklist_items.task_id and p.id = task_checklist_items.project_id and p.owner_id = auth.uid() and t.owner_id = auth.uid()
    )
  );
