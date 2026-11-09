import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const projectColumns = 'id, name, description, created_at';
const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function createProjectsRouter(database, authenticate = requireAuth) {
  const router = Router();

  router.use(authenticate);
  router.param('projectId', (request, response, next, projectId) => {
    if (!projectIdPattern.test(projectId)) {
      return response.status(400).json({ error: 'Invalid project ID' });
    }

    return next();
  });

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Project storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT ${projectColumns}
         FROM public.projects
         WHERE owner_id = $1
         ORDER BY created_at DESC, id DESC`,
        [request.user.id],
      );

      return response.json({ projects: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load projects' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Project storage unavailable' });
    }

    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const description = request.body?.description ?? null;

    if (name.length === 0 || Array.from(name).length > 120) {
      return response.status(400).json({ error: 'Name must contain 1 to 120 characters' });
    }

    if (description !== null && typeof description !== 'string') {
      return response.status(400).json({ error: 'Description must be a string' });
    }

    const normalizedDescription = description?.trim() || null;

    if (normalizedDescription && Array.from(normalizedDescription).length > 2000) {
      return response.status(400).json({ error: 'Description must be at most 2000 characters' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.projects (owner_id, name, description)
         VALUES ($1, $2, $3)
         RETURNING ${projectColumns}`,
        [request.user.id, name, normalizedDescription],
      );

      return response.status(201).json({ project: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create project' });
    }
  });

  router.get('/:projectId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Project storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT ${projectColumns}
         FROM public.projects
         WHERE owner_id = $1 AND id = $2`,
        [request.user.id, request.params.projectId],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.json({ project: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to load project' });
    }
  });

  router.patch('/:projectId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Project storage unavailable' });
    }

    const body = request.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return response.status(400).json({ error: 'Request body must be an object' });
    }

    const fields = Object.keys(body);

    if (fields.length === 0 || fields.some((field) => !['name', 'description'].includes(field))) {
      return response.status(400).json({ error: 'Only name and description can be updated' });
    }

    const assignments = [];
    const values = [request.user.id, request.params.projectId];

    if (Object.hasOwn(body, 'name')) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';

      if (name.length === 0 || Array.from(name).length > 120) {
        return response.status(400).json({ error: 'Name must contain 1 to 120 characters' });
      }

      values.push(name);
      assignments.push(`name = $${values.length}`);
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

    try {
      const result = await database.query(
        `UPDATE public.projects
         SET ${assignments.join(', ')}
         WHERE owner_id = $1 AND id = $2
         RETURNING ${projectColumns}`,
        values,
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.json({ project: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to update project' });
    }
  });

  router.delete('/:projectId', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Project storage unavailable' });
    }

    try {
      const result = await database.query(
        `DELETE FROM public.projects
         WHERE owner_id = $1 AND id = $2
         RETURNING id`,
        [request.user.id, request.params.projectId],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.status(204).end();
    } catch {
      return response.status(500).json({ error: 'Unable to delete project' });
    }
  });

  return router;
}