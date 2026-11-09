create policy "Users can update tasks in their own projects"
  on public.tasks
  for update
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  )
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );

create policy "Users can delete tasks in their own projects"
  on public.tasks
  for delete
  to authenticated
  using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.projects p
      where p.id = tasks.project_id and p.owner_id = auth.uid()
    )
  );