import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const notificationIdPattern = projectIdPattern;
const notificationTypes = new Set(['info', 'success', 'warning', 'error']);

export function createNotificationsRouter(database, authenticate = requireAuth) {
  const router = Router({ mergeParams: true });

  router.use(authenticate);
  router.use((request, response, next) => {
    if (!projectIdPattern.test(request.params.projectId)) {
      return response.status(400).json({ error: 'Invalid project ID' });
    }

    return next();
  });
  router.param('notificationId', (request, response, next, notificationId) => {
    if (!notificationIdPattern.test(notificationId)) {
      return response.status(400).json({ error: 'Invalid notification ID' });
    }

    return next();
  });

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Notification storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT id, project_id, owner_id, message, type, read, created_at
         FROM public.project_notifications
         WHERE project_id = $1 AND owner_id = $2
         ORDER BY created_at DESC, id DESC`,
        [request.params.projectId, request.user.id],
      );

      return response.json({ notifications: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load notifications' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Notification storage unavailable' });
    }

    const message = typeof request.body?.message === 'string' ? request.body.message.trim() : '';
    const type = typeof request.body?.type === 'string' ? request.body.type.trim() : '';
    const read = request.body?.read ?? false;

    if (message.length === 0 || Array.from(message).length > 1000) {
      return response.status(400).json({ error: 'Message must contain 1 to 1000 characters' });
    }

    if (!notificationTypes.has(type)) {
      return response.status(400).json({ error: 'Type must be info, success, warning, or error' });
    }

    if (typeof read !== 'boolean') {
      return response.status(400).json({ error: 'Read must be a boolean' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.project_notifications (project_id, owner_id, message, type, read)
         SELECT p.id, p.owner_id, $3, $4, $5
         FROM public.projects p
         WHERE p.id = $1 AND p.owner_id = $2
         RETURNING id, project_id, owner_id, message, type, read, created_at`,
        [request.params.projectId, request.user.id, message, type, read],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.status(201).json({ notification: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create notification' });
    }
  });

  router.patch('/:notificationId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Notification storage unavailable' });
    }

    const body = request.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response.status(400).json({ error: 'Request body must be an object' });
    }

    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'read')) {
      return response.status(400).json({ error: 'Only a boolean read value can be updated' });
    }

    if (typeof body.read !== 'boolean') {
      return response.status(400).json({ error: 'Read must be a boolean' });
    }

    try {
      const result = await database.query(
        `UPDATE public.project_notifications
         SET read = $4
         WHERE id = $1 AND project_id = $2 AND owner_id = $3
         RETURNING id, project_id, owner_id, message, type, read, created_at`,
        [request.params.notificationId, request.params.projectId, request.user.id, body.read],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Notification not found' });
      }

      return response.json({ notification: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to update notification' });
    }
  });

  return router;
}
