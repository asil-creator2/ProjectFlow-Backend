import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createProjectsRouter } from './projects.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withProjectsServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects', createProjectsRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /api/projects returns only the authenticated user\'s projects', async () => {
  const projects = [{ id: 'project-1', name: 'Roadmap', description: null }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: projects };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { projects });
  });

  assert.match(query.sql, /WHERE owner_id = \$1/);
  assert.deepEqual(query.values, [testUserId]);
});

test('POST /api/projects uses the authenticated user as owner', async () => {
  const project = { id: 'project-1', name: 'Roadmap', description: 'Q4 plan' };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [project] };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Roadmap ', description: ' Q4 plan ' }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { project });
  });

  assert.match(query.sql, /INSERT INTO public\.projects \(owner_id, name, description\)/);
  assert.deepEqual(query.values, [testUserId, 'Roadmap', 'Q4 plan']);
});

test('POST /api/projects rejects an invalid name without querying the database', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Name must contain 1 to 120 characters' });
  });

  assert.equal(queryCalled, false);
});

test('GET /api/projects/:projectId scopes the lookup to the authenticated user', async () => {
  const project = { id: testProjectId, name: 'Roadmap', description: null };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [project], rowCount: 1 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${testProjectId}`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { project });
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND id = \$2/);
  assert.deepEqual(query.values, [testUserId, testProjectId]);
});

test('GET /api/projects/:projectId returns 404 for a project not owned by the user', async () => {
  const database = {
    async query(sql, values) {
      assert.match(sql, /WHERE owner_id = \$1 AND id = \$2/);
      assert.deepEqual(values, [testUserId, testProjectId]);
      return { rows: [], rowCount: 0 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${testProjectId}`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Project not found' });
  });
});

test('PATCH /api/projects/:projectId updates only allowed fields for the owner', async () => {
  const project = { id: testProjectId, name: 'Updated roadmap', description: null };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [project], rowCount: 1 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${testProjectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: ' Updated roadmap ', description: null }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { project });
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND id = \$2/);
  assert.deepEqual(query.values, [testUserId, testProjectId, 'Updated roadmap', null]);
});

test('PATCH /api/projects/:projectId rejects owner changes', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${testProjectId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ owner_id: 'other-user' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Only name and description can be updated' });
  });

  assert.equal(queryCalled, false);
});

test('DELETE /api/projects/:projectId deletes only for the owner', async () => {
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [{ id: testProjectId }], rowCount: 1 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${testProjectId}`, { method: 'DELETE' });

    assert.equal(response.status, 204);
    assert.equal(await response.text(), '');
  });

  assert.match(query.sql, /WHERE owner_id = \$1 AND id = \$2/);
  assert.deepEqual(query.values, [testUserId, testProjectId]);
});

test('project routes reject malformed IDs before querying the database', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withProjectsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/not-a-uuid`);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid project ID' });
  });

  assert.equal(queryCalled, false);
});

test('project routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withProjectsServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});

test('project routes report unavailable storage without querying', async () => {
  await withProjectsServer(null, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'Project storage unavailable' });
  });
});