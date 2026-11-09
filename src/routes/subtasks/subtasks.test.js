import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createSubtasksRouter } from './subtasks.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testTaskId = '22222222-2222-4222-8222-222222222222';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withSubtasksServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks/:taskId/subtasks', createSubtasksRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/tasks/${testTaskId}/subtasks`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /subtasks returns only subtasks for the authenticated task owner', async () => {
  const subtasks = [{ id: 'subtask-1', task_id: testTaskId, project_id: testProjectId, title: 'Prepare assets', completed: false }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: subtasks };
    },
  };

  await withSubtasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { subtasks });
  });

  assert.match(query.sql, /JOIN public\.tasks t ON t\.id = s\.task_id/);
  assert.match(query.sql, /p\.owner_id = \$3 AND t\.owner_id = \$3 AND s\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId]);
});

test('POST /subtasks creates a subtask in the authenticated task scope', async () => {
  const subtask = {
    id: 'subtask-1',
    task_id: testTaskId,
    project_id: testProjectId,
    title: 'Prepare assets',
    completed: true,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [subtask], rowCount: 1 };
    },
  };

  await withSubtasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: ' Prepare assets ', completed: true }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { subtask });
  });

  assert.match(query.sql, /INSERT INTO public\.task_subtasks \(task_id, project_id, owner_id, title, completed\)/);
  assert.match(query.sql, /WHERE t\.id = \$1 AND p\.id = \$2 AND p\.owner_id = \$3 AND t\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId, 'Prepare assets', true]);
});

test('POST /subtasks rejects empty titles or invalid completed values before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withSubtasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: '   ', completed: 'yes' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Title must contain 1 to 120 characters' });
  });

  assert.equal(queryCalled, false);
});

test('subtask routes reject malformed task or project IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withSubtasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testTaskId, 'invalid-task-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid task ID' });
  });

  assert.equal(queryCalled, false);
});

test('subtask routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withSubtasksServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});
