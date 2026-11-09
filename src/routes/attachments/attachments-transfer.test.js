import assert from 'node:assert/strict';
import express from 'express';
import { test } from 'node:test';
import { createAttachmentsRouter } from './attachments.js';

process.env.SUPABASE_URL = 'https://project.supabase.co';

const testUserId = 'user-123';
const testAccessToken = 'verified-test-token';
const testProjectId = '11111111-1111-4111-8111-111111111111';
const testTaskId = '22222222-2222-4222-8222-222222222222';
const testAttachmentId = '33333333-3333-4333-8333-333333333333';
const authenticateAsTestUser = (request, _response, next) => {
  request.user = { id: testUserId };
  request.accessToken = testAccessToken;
  next();
};

async function withTransferServer(database, storageClientFactory, run) {
  const app = express();
  app.use(express.json());
  app.use('/api/projects/:projectId/tasks/:taskId/attachments', createAttachmentsRouter(database, authenticateAsTestUser, storageClientFactory));

  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));

  try {
    await run(`http://127.0.0.1:${server.address().port}/api/projects/${testProjectId}/tasks/${testTaskId}/attachments`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function createStorageStub() {
  const calls = { bucket: null, upload: null, remove: null, signedUrl: null };
  const storageClient = {
    storage: {
      from(bucket) {
        calls.bucket = bucket;
        return {
          async upload(path, bytes, options) {
            calls.upload = { path, bytes, options };
            return { data: { path }, error: null };
          },
          async remove(paths) {
            calls.remove = paths;
            return { data: paths, error: null };
          },
          async createSignedUrl(path, expiresIn) {
            calls.signedUrl = { path, expiresIn };
            return { data: { signedUrl: 'https://storage.example.com/signed-download' }, error: null };
          },
        };
      },
    },
  };

  return { calls, storageClient };
}

test('POST /attachments/upload stores file bytes and metadata in the authenticated task scope', async () => {
  const bytes = Buffer.from('actual file bytes');
  const attachment = {
    id: testAttachmentId,
    task_id: testTaskId,
    project_id: testProjectId,
    owner_id: testUserId,
    filename: 'design.png',
    content_type: 'image/png',
    size_bytes: bytes.length,
    storage_path: `${testUserId}/${testProjectId}/${testTaskId}/random-design.png`,
  };
  let query;
  const database = {
    async query(sql, values) {
      query = { sql, values };
      return { rows: [attachment], rowCount: 1 };
    },
  };
  const { calls, storageClient } = createStorageStub();
  const storageClientFactory = (accessToken) => {
    assert.equal(accessToken, testAccessToken);
    return storageClient;
  };

  await withTransferServer(database, storageClientFactory, async (url) => {
    const response = await fetch(`${url}/upload?filename=design.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    });

    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { attachment });
  });

  assert.equal(calls.bucket, 'task-attachments');
  assert.equal(calls.upload.bytes.toString(), bytes.toString());
  assert.equal(calls.upload.options.contentType, 'image/png');
  assert.match(calls.upload.path, new RegExp(`^${testUserId}/${testProjectId}/${testTaskId}/`));
  assert.match(query.sql, /INSERT INTO public\.task_attachments .*storage_path/);
  assert.match(query.sql, /WHERE t\.id = \$1 AND p\.id = \$2 AND p\.owner_id = \$3 AND t\.owner_id = \$3/);
  assert.deepEqual(query.values.slice(0, 5), [testTaskId, testProjectId, testUserId, 'design.png', 'image/png']);
  assert.equal(query.values[5], bytes.length);
  assert.match(query.values[6], /^https:\/\/project\.supabase\.co\/storage\/v1\/object\/authenticated\/task-attachments\//);
  assert.equal(query.values[7], calls.upload.path);
});

test('POST /attachments/upload rejects missing filenames before storage or database access', async () => {
  let queryCalled = false;
  let storageCalled = false;
  const database = {
    async query() {
      queryCalled = true;
      return { rows: [] };
    },
  };
  const storageClientFactory = () => {
    storageCalled = true;
    return createStorageStub().storageClient;
  };

  await withTransferServer(database, storageClientFactory, async (url) => {
    const response = await fetch(`${url}/upload`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('bytes'),
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Filename must contain 1 to 255 characters' });
  });

  assert.equal(storageCalled, false);
  assert.equal(queryCalled, false);
});

test('POST /attachments/upload removes the uploaded object when the task is not owned', async () => {
  const database = {
    async query() {
      return { rows: [], rowCount: 0 };
    },
  };
  const { calls, storageClient } = createStorageStub();

  await withTransferServer(database, () => storageClient, async (url) => {
    const response = await fetch(`${url}/upload?filename=design.png`, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: Buffer.from('bytes'),
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'Task not found' });
  });

  assert.equal(calls.remove.length, 1);
  assert.match(calls.remove[0], new RegExp(`^${testUserId}/${testProjectId}/${testTaskId}/`));
});

test('GET /attachments/:attachmentId/download returns a short-lived URL for the owned attachment', async () => {
  const storagePath = `${testUserId}/${testProjectId}/${testTaskId}/design.png`;
  const database = {
    async query(sql, values) {
      assert.match(sql, /WHERE id = \$1 AND task_id = \$2 AND project_id = \$3 AND owner_id = \$4/);
      assert.deepEqual(values, [testAttachmentId, testTaskId, testProjectId, testUserId]);
      return { rows: [{ storage_path: storagePath }], rowCount: 1 };
    },
  };
  const { calls, storageClient } = createStorageStub();

  await withTransferServer(database, () => storageClient, async (url) => {
    const response = await fetch(`${url}/${testAttachmentId}/download`);

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      url: 'https://storage.example.com/signed-download',
      expires_in: 60,
    });
  });

  assert.equal(calls.signedUrl.path, storagePath);
  assert.equal(calls.signedUrl.expiresIn, 60);
});
