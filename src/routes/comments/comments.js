import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const commentColumns = 'id, task_id, owner_id, body, created_at';
const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const taskIdPattern = projectIdPattern;

export function createCommentsRouter(database, authenticate = requireAuth) {
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

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Comment storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT c.${commentColumns.replace(/, /g, ', c.')}
         FROM public.comments c
         JOIN public.tasks t ON t.id = c.task_id
         JOIN public.projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.id = $2 AND p.owner_id = $3 AND c.owner_id = $3 AND t.owner_id = $3
         ORDER BY c.created_at ASC, c.id ASC`,
        [request.params.taskId, request.params.projectId, request.user.id],
      );

      return response.json({ comments: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load comments' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Comment storage unavailable' });
    }

    const body = typeof request.body?.body === 'string' ? request.body.body.trim() : '';

    if (body.length === 0 || Array.from(body).length > 2000) {
      return response.status(400).json({ error: 'Comment must contain 1 to 2000 characters' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.comments (task_id, owner_id, body)
         SELECT t.id, t.owner_id, $4
         FROM public.tasks t
         JOIN public.projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3
         RETURNING id, task_id, owner_id, body, created_at`,
        [request.params.taskId, request.params.projectId, request.user.id, body],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.status(201).json({
        comment: {
          ...result.rows[0],
          project_id: request.params.projectId,
        },
      });
    } catch {
      return response.status(500).json({ error: 'Unable to create comment' });
    }
  });

  return router;
}
