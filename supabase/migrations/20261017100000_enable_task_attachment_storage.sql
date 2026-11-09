alter table public.task_attachments
  add column storage_path text;

insert into storage.buckets (id, name, public, file_size_limit)
values ('task-attachments', 'task-attachments', false, 10485760)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create policy "Project owners can upload task attachment objects"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.projects p
      join public.tasks t on t.project_id = p.id
      where p.id::text = (storage.foldername(name))[2]
        and t.id::text = (storage.foldername(name))[3]
        and p.owner_id = auth.uid()
        and t.owner_id = auth.uid()
    )
  );

create policy "Project owners can read task attachment objects"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.projects p
      join public.tasks t on t.project_id = p.id
      where p.id::text = (storage.foldername(name))[2]
        and t.id::text = (storage.foldername(name))[3]
        and p.owner_id = auth.uid()
        and t.owner_id = auth.uid()
    )
  );

create policy "Project owners can remove task attachment objects"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'task-attachments'
    and (storage.foldername(name))[1] = auth.uid()::text
    and exists (
      select 1
      from public.projects p
      join public.tasks t on t.project_id = p.id
      where p.id::text = (storage.foldername(name))[2]
        and t.id::text = (storage.foldername(name))[3]
        and p.owner_id = auth.uid()
        and t.owner_id = auth.uid()
    )
  );
