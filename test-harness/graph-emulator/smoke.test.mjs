import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';

const emulatorPort = 14010;
const webhookPort = 14011;
const base = `http://127.0.0.1:${emulatorPort}`;
let emulator;
let webhook;
const notifications = [];

async function waitFor(url) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try { if ((await fetch(url)).status < 500) return; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

before(async () => {
  webhook = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.searchParams.has('validationToken')) {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(url.searchParams.get('validationToken'));
    }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    notifications.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    res.writeHead(202); res.end();
  }).listen(webhookPort, '127.0.0.1');
  emulator = spawn(process.execPath, ['server.mjs'], {
    cwd: new URL('.', import.meta.url),
    env: { ...process.env, PORT: String(emulatorPort) },
    stdio: 'ignore',
  });
  await waitFor(`${base}/__control/subscriptions`);
});

after(async () => {
  emulator?.kill('SIGTERM');
  await new Promise((resolve) => webhook.close(resolve));
});

test('OAuth pins refresh tokens to the issuing client', async () => {
  for (const [clientId, clientSecret] of [['premise-app', 'premise-secret'], ['other-app', 'other-secret']]) {
    await fetch(`${base}/__control/clients`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, clientSecret }) });
  }
  const redirectUri = 'http://localhost/callback';
  const authorize = new URL(`${base}/common/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({ client_id: 'premise-app', redirect_uri: redirectUri, state: 'state' });
  const authResponse = await fetch(authorize, { redirect: 'manual' });
  const code = new URL(authResponse.headers.get('location')).searchParams.get('code');
  const tokenResponse = await fetch(`${base}/common/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'premise-app', client_secret: 'premise-secret', code, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
  const tokens = await tokenResponse.json();
  assert.ok(tokens.refresh_token);
  const wrongClient = await fetch(`${base}/common/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'other-app', client_secret: 'other-secret', refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
  assert.equal(wrongClient.status, 400);
  const refreshed = await fetch(`${base}/common/oauth2/v2.0/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: 'premise-app', client_secret: 'premise-secret', refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }) });
  assert.equal(refreshed.status, 200);
  globalThis.accessToken = (await refreshed.json()).access_token;
});

test('mail listing, subscription validation, and notification push work together', async () => {
  const headers = { authorization: `Bearer ${globalThis.accessToken}`, 'content-type': 'application/json' };
  const subscription = await fetch(`${base}/v1.0/subscriptions`, { method: 'POST', headers, body: JSON.stringify({ changeType: 'created', notificationUrl: `http://127.0.0.1:${webhookPort}/webhook`, resource: '/me/mailFolders/inbox/messages', expirationDateTime: new Date(Date.now() + 3600000).toISOString(), clientState: 'secret-state' }) });
  assert.equal(subscription.status, 201);
  const seeded = await fetch(`${base}/__control/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject: 'Backfill me' }) });
  const message = await seeded.json();
  const listed = await fetch(`${base}/v1.0/me/mailFolders/inbox/messages?%24filter=${encodeURIComponent(`receivedDateTime ge ${new Date(Date.now() - 60000).toISOString()}`)}`, { headers });
  assert.equal((await listed.json()).value[0].id, message.id);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(notifications[0].value[0].resourceData.id, message.id);
});
