import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.DATABASE_URL = '';
const { default: app } = await import('./app.js');

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('GET /api/health returns an ok status', async () => {
  const response = await fetch(`${baseUrl}/api/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
});

test('GET /api/health/ready reports when the database is not configured', async () => {
  const response = await fetch(`${baseUrl}/api/health/ready`);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready' });
});

test('CORS allows only the configured origin', async () => {
  const allowed = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'http://localhost:5173' },
  });
  const blocked = await fetch(`${baseUrl}/api/health`, {
    headers: { Origin: 'https://untrusted.example' },
  });

  assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});