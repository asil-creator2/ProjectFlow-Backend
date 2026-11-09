create table public.project_labels (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now()
);

create index project_labels_project_created_at_idx
  on public.project_labels (project_id, created_at, id);

alter table public.project_labels enable row level security;

create policy "Users can read labels in their own projects"
  on public.project_labels
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Users can create labels in their own projects"
  on public.project_labels
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Users can update their own labels"
  on public.project_labels
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Users can delete their own labels"
  on public.project_labels
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );
