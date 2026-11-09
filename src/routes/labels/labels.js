import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

export function createLabelsRouter(database, authenticate = requireAuth) {
  const router = Router({ mergeParams: true });

  router.use(authenticate);
  router.use((request, response, next) => {
    if (!projectIdPattern.test(request.params.projectId)) {
      return response.status(400).json({ error: 'Invalid project ID' });
    }

    return next();
  });

  router.get('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Label storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT id, project_id, owner_id, name, color, created_at
         FROM public.project_labels
         WHERE owner_id = $1 AND project_id = $2
         ORDER BY created_at ASC, id ASC`,
        [request.user.id, request.params.projectId],
      );

      return response.json({ labels: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load labels' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Label storage unavailable' });
    }

    const name = typeof request.body?.name === 'string' ? request.body.name.trim() : '';
    const color = typeof request.body?.color === 'string' ? request.body.color.trim() : '';

    if (name.length === 0 || Array.from(name).length > 120) {
      return response.status(400).json({ error: 'Name must contain 1 to 120 characters' });
    }

    if (color.length === 0 || !/^#[0-9A-Fa-f]{6}$/.test(color)) {
      return response.status(400).json({ error: 'Color must be a valid hex code like #FF0000' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.project_labels (project_id, owner_id, name, color)
         SELECT p.id, p.owner_id, $3, $4
         FROM public.projects p
         WHERE p.id = $1 AND p.owner_id = $2
         RETURNING id, project_id, owner_id, name, color, created_at`,
        [request.params.projectId, request.user.id, name, color],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.status(201).json({ label: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create label' });
    }
  });

  return router;
}
