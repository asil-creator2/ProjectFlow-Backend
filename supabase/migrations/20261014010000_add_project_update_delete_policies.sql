create policy "Users can update their own projects"
  on public.projects
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Users can delete their own projects"
  on public.projects
  for delete
  to authenticated
  using (auth.uid() = owner_id);