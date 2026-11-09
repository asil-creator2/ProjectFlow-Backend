import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createMembersRouter } from './members.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testMemberId = '33333333-3333-4333-8333-333333333333';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withMembersServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/members', createMembersRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/members`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /members returns only members for the authenticated project owner', async () => {
  const members = [{ id: testMemberId, project_id: testProjectId, user_id: 'member-user', role: 'editor' }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: members };
    },
  };

  await withMembersServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { members });
  });

  assert.match(query.sql, /FROM public\.project_members/);
  assert.match(query.sql, /WHERE project_id = \$1 AND owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId]);
});

test('POST /members creates a member in the authenticated project scope', async () => {
  const member = {
    id: testMemberId,
    project_id: testProjectId,
    user_id: 'member-user',
    role: 'editor',
    owner_id: testUserId,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [member], rowCount: 1 };
    },
  };

  await withMembersServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: ' member-user ', role: 'editor' }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { member });
  });

  assert.match(query.sql, /INSERT INTO public\.project_members \(project_id, owner_id, user_id, role\)/);
  assert.match(query.sql, /WHERE p\.id = \$1 AND p\.owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId, 'member-user', 'editor']);
});

test('POST /members rejects invalid input before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withMembersServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ user_id: '   ', role: 'admin' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'User ID must contain 1 to 120 characters' });
  });

  assert.equal(queryCalled, false);
});

test('member routes reject malformed project IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withMembersServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testProjectId, 'invalid-project-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid project ID' });
  });

  assert.equal(queryCalled, false);
});

test('member routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withMembersServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});
