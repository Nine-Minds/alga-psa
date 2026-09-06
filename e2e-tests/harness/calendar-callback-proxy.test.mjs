import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import http from 'node:http';
import https from 'node:https';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCalendarCallbackTls } from './create-calendar-callback-tls.mjs';
import { createCalendarCallbackServer } from './calendar-callback-proxy.mjs';

const directory = mkdtempSync(join(tmpdir(), 'alga-calendar-callback-'));
const received = [];
let application;
let proxy;
let ca;
let port;
const callbackPath = '/api/calendar/webhooks/microsoft';
async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return server.address().port;
}
function request(path = callbackPath, { trusted = true, method = 'POST', body = '', servername = 'localhost' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: '127.0.0.1', port, servername, path, method,
      ...(trusted ? { ca } : {}), agent: false, timeout: 5000,
      headers: { 'content-type': 'application/json', 'x-callback-evidence': 'preserved' } }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
      response.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Test callback timeout')));
    req.end(body);
  });
}
before(async () => {
  const files = createCalendarCallbackTls(directory);
  ca = readFileSync(files.cert);
  application = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    received.push({ url: req.url, method: req.method, headers: req.headers, body: Buffer.concat(chunks).toString() });
    const token = new URL(req.url, 'http://localhost').searchParams.get('validationToken');
    if (token) res.writeHead(200, { 'content-type': 'text/plain' }).end(token);
    else res.writeHead(202, { 'content-type': 'application/json' }).end('{"accepted":true}');
  });
  const targetPort = await listen(application);
  proxy = createCalendarCallbackServer({ key: readFileSync(files.key), cert: ca, targetHost: '127.0.0.1', targetPort });
  port = await listen(proxy);
});
after(async () => {
  for (const server of [proxy, application]) if (server) await new Promise(resolve => server.close(resolve));
  rmSync(directory, { recursive: true, force: true });
});

test('requires certificate trust and the expected hostname', async () => {
  await assert.rejects(request(callbackPath, { trusted: false }), /self.signed certificate|unable to verify/i);
  await assert.rejects(request(callbackPath, { servername: 'unrelated.example' }), /hostname|altnames/i);
  assert.equal(received.length, 0);
});
test('forwards the validation challenge and preserves the exact application response', async () => {
  const response = await request(`${callbackPath}?validationToken=calendar%20validation%2Btoken`);
  assert.equal(response.status, 200);
  assert.equal(response.body, 'calendar validation+token');
  assert.match(response.headers['content-type'], /text\/plain/);
});
test('forwards notification JSON and headers to the fixed application destination', async () => {
  const body = JSON.stringify({ value: [{ subscriptionId: 'sub-1', clientState: 'synthetic-state', changeType: 'updated', resourceData: { id: 'event-1' } }] });
  const response = await request(callbackPath, { body });
  assert.equal(response.status, 202);
  assert.deepEqual(JSON.parse(response.body), { accepted: true });
  const last = received.at(-1);
  assert.equal(last.url, callbackPath);
  assert.equal(last.method, 'POST');
  assert.equal(last.body, body);
  assert.equal(last.headers['x-callback-evidence'], 'preserved');
  assert.equal(last.headers.host, `127.0.0.1:${application.address().port}`);
});
test('rejects unrelated routes and methods before they reach the application', async () => {
  const before = received.length;
  assert.equal((await request('/msp/settings')).status, 404);
  assert.equal((await request(callbackPath, { method: 'GET' })).status, 405);
  assert.equal(received.length, before);
});
test('returns a failure when the application destination is unavailable', async () => {
  await new Promise(resolve => application.close(resolve));
  assert.equal((await request()).status, 502);
});
