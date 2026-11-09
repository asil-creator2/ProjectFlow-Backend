import { Router } from 'express';
import { requireAuth } from '../../middleware/require-auth.js';

const projectIdPattern = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
const memberRoles = new Set(['viewer', 'editor', 'admin']);

export function createMembersRouter(database, authenticate = requireAuth) {
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
      return response.status(503).json({ error: 'Member storage unavailable' });
    }

    try {
      const result = await database.query(
        `SELECT id, project_id, user_id, role, owner_id, created_at
         FROM public.project_members
         WHERE project_id = $1 AND owner_id = $2
         ORDER BY created_at ASC, id ASC`,
        [request.params.projectId, request.user.id],
      );

      return response.json({ members: result.rows });
    } catch {
      return response.status(500).json({ error: 'Unable to load members' });
    }
  });

  router.post('/', async (request, response) => {
    if (!database) {
      return response.status(503).json({ error: 'Member storage unavailable' });
    }

    const userId = typeof request.body?.user_id === 'string' ? request.body.user_id.trim() : '';
    const role = typeof request.body?.role === 'string' ? request.body.role.trim() : '';

    if (userId.length === 0 || Array.from(userId).length > 120) {
      return response.status(400).json({ error: 'User ID must contain 1 to 120 characters' });
    }

    if (!memberRoles.has(role)) {
      return response.status(400).json({ error: 'Role must be viewer, editor, or admin' });
    }

    try {
      const result = await database.query(
        `INSERT INTO public.project_members (project_id, owner_id, user_id, role)
         SELECT p.id, p.owner_id, $3, $4
         FROM public.projects p
         WHERE p.id = $1 AND p.owner_id = $2
         RETURNING id, project_id, user_id, role, owner_id, created_at`,
        [request.params.projectId, request.user.id, userId, role],
      );

      if (result.rowCount === 0) {
        return response.status(404).json({ error: 'Project not found' });
      }

      return response.status(201).json({ member: result.rows[0] });
    } catch {
      return response.status(500).json({ error: 'Unable to create member' });
    }
  });

  return router;
}
