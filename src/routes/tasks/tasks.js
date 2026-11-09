import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const taskColumns = 'id, project_id, title, description, status, due_date, created_at';
const taskStatuses = new Set(['todo', 'in_progress', 'done']);
const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const taskIdPattern = projectIdPattern;

function isValidDueDate(value) {
  if (value === null) {
    return true;
  }

  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function createTasksRouter(database, authenticate = requireAuth) {
  const router = Router({ mergeParams: true });

  router.use(authenticate);
  router.use((request, response, next) => {
    if (!projectIdPattern.test(request.params.projectId)) {
      return response.status(400).json({ error: 'Invalid project ID' });
    }

    return next();
  });
  router.param('taskId', (request, response, next, taskId) => {
    if (!taskIdPattern.test(taskId)) {
      return response.status(400).json({ error: 'Invalid task ID' });
    }

    return next();
  });

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Task storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT ${taskColumns}
         FROM public.tasks t
         JOIN public.projects p ON p.id = t.project_id
         WHERE p.id = $1 AND p.owner_id = $2 AND t.owner_id = $2
         ORDER BY t.created_at, t.id`,
        [request.params.projectId, request.user.id],
      );

      return response.json({ tasks: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load tasks' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Task storage unavailable' });
    }

    const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
    const description = request.body?.description ?? null;
    const status = request.body?.status ?? 'todo';
    const dueDate = request.body?.due_date ?? null;

    if (title.length === 0 || Array.from(title).length > 120) {
      return response.status(400).json({ error: 'Title must contain 1 to 120 characters' });
    }

    if (description !== null && typeof description !== 'string') {
      return response.status(400).json({ error: 'Description must be a string or null' });
    }

    const normalizedDescription = typeof description === 'string' ? description.trim() || null : null;

    if (normalizedDescription && Array.from(normalizedDescription).length > 2000) {
      return response.status(400).json({ error: 'Description must be at most 2000 characters' });
    }

    if (typeof status !== 'string' || !taskStatuses.has(status)) {
      return response.status(400).json({ error: 'Status must be todo, in_progress, or done' });
    }

    if (!isValidDueDate(dueDate)) {
      return response.status(400).json({ error: 'Due date must be a valid YYYY-MM-DD date or null' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.tasks (project_id, owner_id, title, description, status, due_date)
         SELECT p.id, p.owner_id, $3, $4, $5, $6
         FROM public.projects p
         WHERE p.id = $1 AND p.owner_id = $2
         RETURNING ${taskColumns}`,
        [request.params.projectId, request.user.id, title, normalizedDescription, status, dueDate],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.status(201).json({ task: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create task' });
    }
  });

  router.get('/:taskId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Task storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT ${taskColumns}
         FROM public.tasks
         WHERE owner_id = $1 AND project_id = $2 AND id = $3`,
        [request.user.id, request.params.projectId, request.params.taskId],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.json({ task: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to load task' });
    }
  });

  router.patch('/:taskId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Task storage unavailable' });
    }

    const body = request.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response.status(400).json({ error: 'Request body must be an object' });
    }

    const fields = Object.keys(body);
    const editableFields = ['title', 'description', 'status', 'due_date'];

    if (fields.length === 0 || fields.some((field) => !editableFields.includes(field))) {
      return response.status(400).json({ error: 'Only title, description, status, and due_date can be updated' });
    }

    const assignments = [];
    const values = [request.user.id, request.params.projectId, request.params.taskId];

    if (Object.hasOwn(body, 'title')) {
      const title = typeof body.title === 'string' ? body.title.trim() : '';

      if (title.length === 0 || Array.from(title).length > 120) {
        return response.status(400).json({ error: 'Title must contain 1 to 120 characters' });
      }

      values.push(title);
      assignments.push(`title = $${values.length}`);
    }

    if (Object.hasOwn(body, 'description')) {
      if (body.description !== null && typeof body.description !== 'string') {
        return response.status(400).json({ error: 'Description must be a string or null' });
      }

      const description = typeof body.description === 'string' ? body.description.trim() || null : null;

      if (description && Array.from(description).length > 2000) {
        return response.status(400).json({ error: 'Description must be at most 2000 characters' });
      }

      values.push(description);
      assignments.push(`description = $${values.length}`);
    }

    if (Object.hasOwn(body, 'status')) {
      if (typeof body.status !== 'string' || !taskStatuses.has(body.status)) {
        return response.status(400).json({ error: 'Status must be todo, in_progress, or done' });
      }

      values.push(body.status);
      assignments.push(`status = $${values.length}`);
    }

    if (Object.hasOwn(body, 'due_date')) {
      if (!isValidDueDate(body.due_date)) {
        return response.status(400).json({ error: 'Due date must be a valid YYYY-MM-DD date or null' });
      }

      values.push(body.due_date);
      assignments.push(`due_date = $${values.length}`);
    }

    try {
      const result = await database.query(
        `UPDATE public.tasks
         SET ${assignments.join(', ')}
         WHERE owner_id = $1 AND project_id = $2 AND id = $3
         RETURNING ${taskColumns}`,
        values,
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.json({ task: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to update task' });
    }
  });

  router.delete('/:taskId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Task storage unavailable' });
    }

    try {
      const result = await database.query(
        `DELETE FROM public.tasks
         WHERE owner_id = $1 AND project_id = $2 AND id = $3
         RETURNING id`,
        [request.user.id, request.params.projectId, request.params.taskId],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Task not found' });
      }

      return response.status(204).end();
    } catch {
      return response.status(500).json({ error: 'Unable to delete task' });
    }
  });

  return router;
}