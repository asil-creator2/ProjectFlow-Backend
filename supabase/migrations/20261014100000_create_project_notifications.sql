create table public.project_notifications (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  message text not null check (char_length(btrim(message)) between 1 and 1000),
  type text not null check (type in ('info', 'success', 'warning', 'error')),
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index project_notifications_project_created_at_idx
  on public.project_notifications (project_id, created_at, id);

alter table public.project_notifications enable row level security;

create policy "Users can read notifications in their own projects"
  on public.project_notifications
  for select
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Users can create notifications in their own projects"
  on public.project_notifications
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );

create policy "Users can update their own notifications"
  on public.project_notifications
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

create policy "Users can delete their own notifications"
  on public.project_notifications
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and project_id in (
      select id from public.projects where owner_id = auth.uid()
    )
  );
