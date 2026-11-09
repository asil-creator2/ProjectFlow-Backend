import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const taskIdPattern = projectIdPattern;

export function createSubtasksRouter(database, authenticate = requireAuth) {
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
      return response.status(503).json({ error: 'Subtask storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT s.id, s.task_id, s.project_id, s.owner_id, s.title, s.completed, s.created_at
         FROM public.task_subtasks s
         JOIN public.tasks t ON t.id = s.task_id
         JOIN public.projects p ON p.id = s.project_id
         WHERE s.task_id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3 AND s.owner_id = $3
         ORDER BY s.created_at ASC, s.id ASC`,
        [request.params.taskId, request.params.projectId, request.user.id],
      );

      return response.json({ subtasks: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load subtasks' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Subtask storage unavailable' });
    }

    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
    const completed = request.body?.completed ?? false;

    if (title.length === 0 || Array.from(title).length > 120) {
      return response.status(400).json({ error: 'Title must contain 1 to 120 characters' });
    }

    if (typeof completed !== 'boolean') {
      return response.status(400).json({ error: 'Completed must be a boolean' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.task_subtasks (task_id, project_id, owner_id, title, completed)
         SELECT t.id, p.id, t.owner_id, $4, $5
         FROM public.tasks t
         JOIN public.projects p ON p.id = t.project_id
         WHERE t.id = $1 AND p.id = $2 AND p.owner_id = $3 AND t.owner_id = $3
         RETURNING id, task_id, project_id, owner_id, title, completed, created_at`,
        [request.params.taskId, request.params.projectId, request.user.id, title, completed],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.status(201).json({ subtask: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create subtask' });
    }
  });

  return router;
}
