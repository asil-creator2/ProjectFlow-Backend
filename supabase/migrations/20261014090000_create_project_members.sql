create table public.project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('viewer', 'editor', 'admin')),
  created_at timestamptz not null default now()
);

create index project_members_project_created_at_idx
  on public.project_members (project_id, created_at, id);

alter table public.project_members enable row level security;

create policy "Project owners can read all members"
  on public.project_members
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Project owners can add members"
  on public.project_members
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Project owners can update member roles"
  on public.project_members
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

create policy "Project owners can remove members"
  on public.project_members
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );
