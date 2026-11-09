import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createNotificationsRouter } from './notifications.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withNotificationsServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/notifications', createNotificationsRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/notifications`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /notifications returns only notifications for the authenticated project owner', async () => {
  const notifications = [{ id: 'note-1', project_id: testProjectId, owner_id: testUserId, message: 'Task updated', type: 'info', read: false }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: notifications };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { notifications });
  });

  assert.match(query.sql, /FROM public\.project_notifications/);
  assert.match(query.sql, /WHERE project_id = \$1 AND owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId]);
});

test('POST /notifications creates a notification in the authenticated project scope', async () => {
  const notification = {
    id: 'note-1',
    project_id: testProjectId,
    owner_id: testUserId,
    message: 'Task updated',
    type: 'info',
    read: false,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [notification], rowCount: 1 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: ' Task updated ', type: 'info', read: false }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { notification });
  });

  assert.match(query.sql, /INSERT INTO public\.project_notifications \(project_id, owner_id, message, type, read\)/);
  assert.match(query.sql, /WHERE p\.id = \$1 AND p\.owner_id = \$2/);
  assert.deepEqual(query.values, [testProjectId, testUserId, 'Task updated', 'info', false]);
});

test('POST /notifications rejects invalid input before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '   ', type: 'info', read: false }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Message must contain 1 to 1000 characters' });
  });

  assert.equal(queryCalled, false);
});

test('PATCH /notifications/:notificationId updates only the read state for the project owner', async () => {
  const notification = {
    id: '33333333-3333-4333-8333-333333333333',
    project_id: testProjectId,
    owner_id: testUserId,
    message: 'Task updated',
    type: 'info',
    read: true,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [notification], rowCount: 1 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/${notification.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { notification });
  });

  assert.match(query.sql, /UPDATE public\.project_notifications/);
  assert.match(query.sql, /WHERE id = \$1 AND project_id = \$2 AND owner_id = \$3/);
  assert.deepEqual(query.values, [notification.id, testProjectId, testUserId, true]);
});

test('PATCH /notifications/:notificationId rejects invalid read values without querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/33333333-3333-4333-8333-333333333333`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: 'yes' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Read must be a boolean' });
  });

  assert.equal(queryCalled, false);
});

test('notification routes reject malformed notification IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(`${url}/not-a-uuid`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ read: true }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid notification ID' });
  });

  assert.equal(queryCalled, false);
});

test('notification routes reject malformed project IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withNotificationsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testProjectId, 'invalid-project-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid project ID' });
  });

  assert.equal(queryCalled, false);
});

test('notification routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withNotificationsServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});
