import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkBackgroundWorkers } from './check-background-workers.mjs';

const ready = { ready: true, workers: { temporal: true, eventStream: true, dataStoreSweep: true } };
async function serve(t, handler) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}/readyz`;
}

test('polls startup 503 until all workers are ready', async t => {
  let requests = 0;
  const url = await serve(t, (req, res) => {
    assert.equal(req.method, 'GET');
    assert.equal(req.url, '/readyz');
    res.statusCode = ++requests < 3 ? 503 : 200;
    res.end(JSON.stringify(ready));
  });
  assert.deepEqual(await checkBackgroundWorkers({ url, timeoutMs: 1000, pollIntervalMs: 5 }), ready);
  assert.equal(requests, 3);
});

for (const [label, body] of [
  ['permanently unready', { ...ready, ready: false }],
  ['missing worker', { ready: true, workers: { temporal: true, eventStream: true } }],
  ['false worker', { ready: true, workers: { ...ready.workers, temporal: false } }],
  ['truthy strings', { ready: 'true', workers: ready.workers }],
  ['generic 200', {}],
  ['malformed JSON', 'not-json'],
]) {
  test(`rejects ${label} instead of accepting HTTP 200`, async t => {
    let requests = 0;
    const url = await serve(t, (_req, res) => { requests++; res.end(typeof body === 'string' ? body : JSON.stringify(body)); });
    await assert.rejects(checkBackgroundWorkers({ url, timeoutMs: 80, pollIntervalMs: 5 }), /readiness timed out/);
    assert.ok(requests >= 1);
  });
}

test('deadline includes a response body that never finishes', async t => {
  const url = await serve(t, (_req, res) => { res.writeHead(200); res.write('{'); });
  const start = performance.now();
  await assert.rejects(checkBackgroundWorkers({ url, timeoutMs: 80, pollIntervalMs: 5 }), /readiness timed out/);
  assert.ok(performance.now() - start < 2000);
});

test('CLI returns nonzero for invalid readiness and zero for all workers ready', async t => {
  let payload = {};
  const url = await serve(t, (_req, res) => res.end(JSON.stringify(payload)));
  const run = async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('./check-background-workers.mjs', import.meta.url)), '--url', url, '--timeout-ms', '100', '--poll-interval-ms', '5'], { stdio: 'ignore' });
    return (await once(child, 'exit'))[0];
  };
  assert.equal(await run(), 1);
  payload = ready;
  assert.equal(await run(), 0);
});
