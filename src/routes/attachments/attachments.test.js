import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createAttachmentsRouter } from './attachments.js';

const testUserId = 'user-123';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testTaskId = '22222222-2222-4222-8222-222222222222';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  next();
};

async function withAttachmentsServer(database, authenticate, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks/:taskId/attachments', createAttachmentsRouter(database, authenticate));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/tasks/${testTaskId}/attachments`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('GET /attachments returns only attachments for the authenticated task owner', async () => {
  const attachments = [{
    id: 'attachment-1',
    task_id: testTaskId,
    project_id: testProjectId,
    owner_id: testUserId,
    filename: 'design.png',
    content_type: 'image/png',
    size_bytes: 1234,
    storage_url: 'https://storage.example.com/design.png',
  }];
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: attachments };
    },
  };

  await withAttachmentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { attachments });
  });

  assert.match(query.sql, /JOIN public\.tasks t ON t\.id = a\.task_id/);
  assert.match(query.sql, /p\.owner_id = \$3 AND t\.owner_id = \$3 AND a\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId]);
});

test('POST /attachments creates an attachment in the authenticated task scope', async () => {
  const attachment = {
    id: 'attachment-1',
    task_id: testTaskId,
    project_id: testProjectId,
    owner_id: testUserId,
    filename: 'design.png',
    content_type: 'image/png',
    size_bytes: 1234,
    storage_url: 'https://storage.example.com/design.png',
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [attachment], rowCount: 1 };
    },
  };

  await withAttachmentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filename: ' design.png ',
        content_type: 'image/png',
        size_bytes: 1234,
        storage_url: 'https://storage.example.com/design.png',
      }),
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { attachment });
  });

  assert.match(query.sql, /INSERT INTO public\.task_attachments \(task_id, project_id, owner_id, filename, content_type, size_bytes, storage_url\)/);
  assert.match(query.sql, /WHERE t\.id = \$1 AND p\.id = \$2 AND p\.owner_id = \$3 AND t\.owner_id = \$3/);
  assert.deepEqual(query.values, [testTaskId, testProjectId, testUserId, 'design.png', 'image/png', 1234, 'https://storage.example.com/design.png']);
});

test('POST /attachments rejects invalid metadata before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withAttachmentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ filename: '   ', size_bytes: 0, storage_url: 'https://storage.example.com/x' }),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Filename must contain 1 to 255 characters' });
  });

  assert.equal(queryCalled, false);
});

test('attachment routes reject malformed task or project IDs before querying storage', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [], rowCount: 0 };
    },
  };

  await withAttachmentsServer(database, authenticateAsTestUser, async (url) => {
    const response = await fetch(url.replace(testTaskId, 'invalid-task-id'));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Invalid task ID' });
  });

  assert.equal(queryCalled, false);
});

test('attachment routes stop before querying when authentication fails', async () => {
  let queryCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const rejectAuthentication = (_request, response) => response.status(401).json({ error: 'Unauthorized' });

  await withAttachmentsServer(database, rejectAuthentication, async (url) => {
    const response = await fetch(url);

    assert.equal(response.status, 401);
  });

  assert.equal(queryCalled, false);
});
