import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createTasksRouter } from './tasks.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testTaskId = '22222222-2222-4222-8222-222222222222';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withTasksServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks', createTasksRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/tasks`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function taskUrl(url, taskId = testTaskId) {
  return `${url}/${taskId}`;
}

test('GET project tasks scopes the list to the authenticated project owner', async () => {
  const tasks = [{ id: 'task-1', project_id: testProjectId, title: 'Plan release', status: 'todo' }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: tasks };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { tasks });
  });

  assert.match(query.sql, /JOIN public\.projects p ON p\.id = t\.project_id/);
  assert.match(query.sql, /p\.owner_id = \$2 AND t\.owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId]);
});

test('POST project task creates it with authenticated ownership and defaults', async () => {
  const task = {
    id: 'task-1',
    project_id: testProjectId,
    title: 'Plan release',
    description: null,
    status: 'todo',
    due_date: null,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [task], rowCount: 1 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: ' Plan release ' }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { task });
  });

  assert.match(query.sql, /SELECT p\.id, p\.owner_id, \$3, \$4, \$5, \$6/);
  assert.match(query.sql, /WHERE p\.id = \$1 AND p\.owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId, 'Plan release', null, 'todo', null]);
});

test('POST project task validates status and due date before querying', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Plan release', status: 'blocked', due_date: '2026-02-30' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Status must be todo, in_progress, or done' });
  });

  assert.equal(queryCalled, false);
});

test('POST project task returns not found when the project is not owned', async () => {
  const database = {
    async query(sql, values) {
      assert.match(sql, /WHERE p\.id = \$1 AND p\.owner_id = \$2/);
      assert.deepEqual(values, [testProjectId, testUserId, 'Plan release', null, 'todo', null]);
      return { rows: [], rowCount: 0 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Plan release' }),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Project not found' });
  });
});

test('task routes do not query storage when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withTasksServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});

test('task routes reject malformed project IDs without querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testProjectId, 'invalid-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid project ID' });
  });

  assert.equal(queryCalled, false);
});

test('GET project task scopes the lookup to its owner and project', async () => {
  const task = { id: testTaskId, project_id: testProjectId, title: 'Plan release', status: 'todo' };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [task], rowCount: 1 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(taskUrl(url));

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { task });
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND project_id = \$2 AND id = \$3/);
  assert.deepEqual(query.values, [testUserId, testProjectId, testTaskId]);
});

test('PATCH project task updates allowed fields for its owner', async () => {
  const task = { id: testTaskId, project_id: testProjectId, title: 'Ship release', status: 'in_progress' };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [task], rowCount: 1 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(taskUrl(url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: ' Ship release ', status: 'in_progress', due_date: null }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { task });
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND project_id = \$2 AND id = \$3/);
  assert.deepEqual(query.values, [testUserId, testProjectId, testTaskId, 'Ship release', 'in_progress', null]);
});

test('PATCH project task rejects owner changes without querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(taskUrl(url), {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_id: 'other-user' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), {
      error: 'Only title, description, status, and due_date can be updated',
    });
  });

  assert.equal(queryCalled, false);
});

test('DELETE project task scopes deletion to its owner and project', async () => {
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [{ id: testTaskId }], rowCount: 1 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(taskUrl(url), { method: 'DELETE' });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND project_id = \$2 AND id = \$3/);
  assert.deepEqual(query.values, [testUserId, testProjectId, testTaskId]);
});

test('task routes reject malformed task IDs without querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withTasksServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(taskUrl(url, 'invalid-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid task ID' });
  });

  assert.equal(queryCalled, false);
});