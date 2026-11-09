import { Router } from 'express';
import { checkDatabaseConnection } from '../config/database.js';

const router = Router();

router.get('/', (_request, response) => {
  response.json({ status: 'ok' });
});

router.get('/ready', async (_request, response) => {
  try {
    await checkDatabaseConnection();
    response.json({ status: 'ready' });
  } catch {
    response.status(503).json({ status: 'not_ready' });
  }
});

export default router;