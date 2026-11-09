import express, { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { requireAuth } from '../../middleware/require-auth.js';

const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const taskIdPattern = projectIdPattern;
const attachmentIdPattern = projectIdPattern;
const maxUploadBytes = 10 * 1024 * 1024;
const signedUrlLifetimeSeconds = 60;

async function createStorageClient(accessToken) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !publishableKey || !accessToken) {
    return null;
  }

  const { createClient } = await import('@supabase/supabase-js');

  return createClient(supabaseUrl, publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}

export function createAttachmentsRouter(database, authenticate = requireAuth, storageClientFactory = createStorageClient) {
  const router = Router({ mergeParams: true });

  router.use(authenticate);
  router.use((request, response, next) => {
    if (!projectIdPattern.test(request.params.projectId)) {
      return response.status(400).json({ error: 'Invalid project ID' });
    }

    if (!taskIdPattern.test(request.params.taskId)) {
      return response.status(400).json({ error: 'Invalid task ID' });
    }

    return next();
  });
  router.param('attachmentId', (request, response, next, attachmentId) => {
    if (!attachmentIdPattern.test(attachmentId)) {
      return response.status(400).json({ error: 'Invalid attachment ID' });
    }

    return next();
  });

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT a.id, a.task_id, a.project_id, a.owner_id, a.filename, a.content_type, a.size_bytes, a.storage_url, a.storage_path, a.created_at
         FROM public.task_attachments a
         JOIN public.tasks t ON t.id = a.task_id
         JOIN public.projects p ON p.id = a.project_id
         WHERE a.task_id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3 AND a.owner_id = $3
         ORDER BY a.created_at ASC, a.id ASC`,
        [request.params.taskId, request.params.projectId, request.user.id],
      );

      return response.json({ attachments: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load attachments' });
    }
  });

  router.post('/upload', (request, response, next) => {
    express.raw({ type: () => true, limit: maxUploadBytes })(request, response, next);
  }, async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    const filename = typeof request.query.filename === 'string' ? request.query.filename.trim() : '';
    const contentType = request.get('content-type')?.split(';', 1)[0].trim() ?? '';
    const bytes = request.body;

    if (filename.length === 0 || Array.from(filename).length > 255) {
      return response.status(400).json({ error: 'Filename must contain 1 to 255 characters' });
    }

    if (!/^[\w.+-]+\/[\w.+-]+$/.test(contentType)) {
      return response.status(400).json({ error: 'A valid content type is required' });
    }

    if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
      return response.status(400).json({ error: 'File content is required' });
    }

    let storageClient;

    try {
      storageClient = await storageClientFactory(request.accessToken);
    } catch {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    if (!storageClient) {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'task-attachments';
    const safeFilename = filename.replace(/[\\/]/g, '_').replace(/[^\w.-]/g, '_');
    const storagePath = `${request.user.id}/${request.params.projectId}/${request.params.taskId}/${randomUUID()}-${safeFilename}`;
    const bucket = storageClient.storage.from(bucketName);

    let uploadResult;

    try {
      uploadResult = await bucket.upload(storagePath, bytes, { contentType, upsert: false });
    } catch {
      return response.status(502).json({ error: 'Unable to upload attachment' });
    }

    if (uploadResult.error) {
      return response.status(502).json({ error: 'Unable to upload attachment' });
    }

    try {
      const supabaseUrl = process.env.SUPABASE_URL;
      const storageUrl = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/authenticated/${bucketName}/${storagePath}`;
      const result = await database.query(
        `INSERT INTO public.task_attachments (task_id, project_id, owner_id, filename, content_type, size_bytes, storage_url, storage_path)
         SELECT t.id, p.id, t.owner_id, $4, $5, $6, $7, $8
         FROM public.tasks t
         JOIN public.projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3
         RETURNING id, task_id, project_id, owner_id, filename, content_type, size_bytes, storage_url, storage_path, created_at`,
        [request.params.taskId, request.params.projectId, request.user.id, filename, contentType, bytes.length, storageUrl, storagePath],
      );

      if (result.rowCount === 0) {
        await bucket.remove([storagePath]);
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.status(201).json({ attachment: result.rows[0] });
    } catch {
      try {
        await bucket.remove([storagePath]);
      } catch {
        return response.status(500).json({ error: 'Unable to save attachment metadata or clean up uploaded file' });
      }

      return response.status(500).json({ error: 'Unable to save attachment metadata' });
    }
  });

  router.get('/:attachmentId/download', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT storage_path
         FROM public.task_attachments
         WHERE id = $1 AND task_id = $2 AND project_id = $3 AND owner_id = $4`,
        [request.params.attachmentId, request.params.taskId, request.params.projectId, request.user.id],
      );

      if (result.rowCount === 0 || !result.rows[0].storage_path) {
        return response.status(404).json({ error: 'Attachment content not found' });
      }

      const storageClient = await storageClientFactory(request.accessToken);

      if (!storageClient) {
        return response.status(503).json({ error: 'Attachment storage unavailable' });
      }

      const bucketName = process.env.SUPABASE_STORAGE_BUCKET || 'task-attachments';
      const { data, error } = await storageClient.storage
        .from(bucketName)
        .createSignedUrl(result.rows[0].storage_path, signedUrlLifetimeSeconds);

      if (error || !data?.signedUrl) {
        return response.status(502).json({ error: 'Unable to create attachment download link' });
      }

      return response.json({ url: data.signedUrl, expires_in: signedUrlLifetimeSeconds });
    } catch {
      return response.status(500).json({ error: 'Unable to load attachment download link' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Attachment storage unavailable' });
    }

    const filename = typeof request.body?.filename === 'string' ? request.body.filename.trim() : '';
    const contentType = typeof request.body?.content_type === 'string' ? request.body.content_type.trim() : '';
    const sizeBytes = request.body?.size_bytes;
    const storageUrl = typeof request.body?.storage_url === 'string' ? request.body.storage_url.trim() : '';

    if (filename.length === 0 || Array.from(filename).length > 255) {
      return response.status(400).json({ error: 'Filename must contain 1 to 255 characters' });
    }

    if (contentType.length === 0 || Array.from(contentType).length > 255) {
      return response.status(400).json({ error: 'Content type must contain 1 to 255 characters' });
    }

    if (!Number.isInteger(sizeBytes) || sizeBytes < 0) {
      return response.status(400).json({ error: 'Size must be a non-negative integer' });
    }

    if (storageUrl.length === 0 || !/^https?:\/\//i.test(storageUrl)) {
      return response.status(400).json({ error: 'Storage URL must be a valid http or https URL' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.task_attachments (task_id, project_id, owner_id, filename, content_type, size_bytes, storage_url)
         SELECT t.id, p.id, t.owner_id, $4, $5, $6, $7
         FROM public.tasks t
         JOIN public.projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3
         RETURNING id, task_id, project_id, owner_id, filename, content_type, size_bytes, storage_url, created_at`,
        [request.params.taskId, request.params.projectId, request.user.id, filename, contentType, sizeBytes, storageUrl],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.status(201).json({ attachment: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create attachment' });
    }
  });

  return router;
}
