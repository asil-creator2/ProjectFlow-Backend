import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createCommentsRouter } from './comments.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testTaskId = '22222222-2222-4222-8222-222222222222';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withCommentsServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks/:taskId/comments', createCommentsRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/tasks/${testTaskId}/comments`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /comments returns only comments for the authenticated task owner', async () => {
  const comments = [{ id: 'comment-1', task_id: testTaskId, owner_id: testUserId, body: 'Looks good' }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: comments };
    },
  };

  await withCommentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { comments });
  });

  assert.match(query.sql, /JOIN public\.tasks t ON t\.id = c\.task_id/);
  assert.match(query.sql, /p\.owner_id = \$3 AND c\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId]);
});

test('POST /comments creates a comment tied to the authenticated user and project task', async () => {
  const comment = {
    id: 'comment-1',
    task_id: testTaskId,
    project_id: testProjectId,
    owner_id: testUserId,
    body: 'Looks good',
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [comment], rowCount: 1 };
    },
  };

  await withCommentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: ' Looks good ' }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { comment });
  });

  assert.match(query.sql, /INSERT INTO public\.comments \(task_id, owner_id, body\)/);
  assert.match(query.sql, /WHERE t\.id = \$1 AND p\.id = \$2 AND p\.owner_id = \$3 AND t\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId, 'Looks good']);
});

test('POST /comments rejects empty or oversized content before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withCommentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: '   ' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Comment must contain 1 to 2000 characters' });
  });

  assert.equal(queryCalled, false);
});

test('comment routes reject malformed task or project IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withCommentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testTaskId, 'invalid-task-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid task ID' });
  });

  assert.equal(queryCalled, false);
});

test('comment routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withCommentsServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});
