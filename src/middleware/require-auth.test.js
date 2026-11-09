import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requireAuth } from './require-auth.js';

process.env.SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_PUBLISHABLE_KEY = 'test-anon-key';

function createHarness(authorization) {
  const request = {
    get: (name) => name.toLowerCase() === 'authorization' ? authorization : undefined,
  };
  const response = {
    statusCode: 200,
    body: null,
    status(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  let nextCalled = false;

  return {
    request,
    response,
    next: () => { nextCalled = true; },
    wasNextCalled: () => nextCalled,
  };
}

test('requireAuth rejects missing and malformed bearer tokens', async () => {
  for (const authorization of [undefined, 'Basic abc', 'Bearer']) {
    const harness = createHarness(authorization);

    await requireAuth(harness.request, harness.response, harness.next);

    assert.equal(harness.response.statusCode, 401);
    assert.equal(harness.wasNextCalled(), false);
  }
});

test('requireAuth attaches the Supabase user for a valid token', async (context) => {
  const user = { id: 'user-123', email: 'user@example.com' };
  const fetchMock = context.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url.href, 'https://project.supabase.co/auth/v1/user');
    assert.equal(options.headers.apikey, 'test-anon-key');
    assert.equal(options.headers.authorization, 'Bearer valid-token');
    return new Response(JSON.stringify(user), { status: 200 });
  });
  const harness = createHarness('Bearer valid-token');

  await requireAuth(harness.request, harness.response, harness.next);

  assert.equal(fetchMock.mock.callCount(), 1);
  assert.deepEqual(harness.request.user, user);
  assert.equal(harness.request.accessToken, 'valid-token');
  assert.equal(harness.wasNextCalled(), true);
});

test('requireAuth rejects a token Supabase does not accept', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 401 }));
  const harness = createHarness('Bearer invalid-token');

  await requireAuth(harness.request, harness.response, harness.next);

  assert.equal(harness.response.statusCode, 401);
  assert.deepEqual(harness.response.body, { error: 'Invalid or expired access token' });
  assert.equal(harness.wasNextCalled(), false);
});

test('requireAuth returns 503 when Supabase cannot be reached', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => {
    throw new Error('Private transport detail');
  });
  const harness = createHarness('Bearer valid-token');

  await requireAuth(harness.request, harness.response, harness.next);

  assert.equal(harness.response.statusCode, 503);
  assert.deepEqual(harness.response.body, { error: 'Authentication service unavailable' });
  assert.equal(harness.wasNextCalled(), false);
});