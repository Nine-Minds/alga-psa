import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, get } from 'node:http';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { installTeamsStaticChunkCapture } from '../../e2e-tests/harness/capture-teams-static-chunks.mjs';
const route = '/_next/static/chunks/app/msp/layout.js';
async function fixture(t, options = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'chunk-observer-'));
  const env = { NODE_ENV: 'development', E2E_TEAMS_DEVELOPMENT: 'true', E2E_DATABASE_ISOLATED: 'true', E2E_STATIC_CHUNK_DIAGNOSTICS_DIR: dir, ...options.env };
  const restore = installTeamsStaticChunkCapture({ ...options, env });
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { restore(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive: true, force: true }); });
  const request = url => new Promise((resolve, reject) => {
    get({ host: '127.0.0.1', port: server.address().port, path: url }, res => {
      const chunks = []; res.on('data', x => chunks.push(x)); res.on('end', () => resolve(Buffer.concat(chunks))); res.on('error', reject);
    }).on('error', reject);
  });
  return { server, request, dir, reports: () => readdirSync(dir).filter(n => n.endsWith('.json')).map(n => ({ metadata: JSON.parse(readFileSync(path.join(dir, n))), bytes: readFileSync(path.join(dir, n.replace('.json', '.bin'))) })) };
}
for (const compressed of [false, true]) test(`captures streamed wire bytes without changing response/callbacks: gzip=${compressed}`, async t => {
  const f = await fixture(t), body = compressed ? gzipSync('const hello = 42;') : Buffer.from('const hello = 42;');
  let callbacks = 0;
  f.server.on('request', (req, res) => {
    res.setHeader('content-type', 'application/javascript');
    if (compressed) res.setHeader('content-encoding', 'gzip');
    assert.equal(typeof res.write(body.subarray(0, 3), () => callbacks++), 'boolean');
    assert.equal(res.end(body.subarray(3), () => callbacks++), res);
  });
  assert.deepEqual(await f.request(route + '?secret=never-retained'), body);
  assert.equal(callbacks, 2);
  const [record] = f.reports(); assert.deepEqual(record.bytes, body);
  assert.equal(record.metadata.complete, true); assert.equal(record.metadata.truncated, false);
  assert.equal(record.metadata.sha256, createHash('sha256').update(body).digest('hex'));
  assert.equal(JSON.stringify(record.metadata).includes('secret'), false);
});
test('bounds bytes and response count while excluding unrelated routes', async t => {
  const f = await fixture(t, { maxBytes: 4 });
  f.server.on('request', (req, res) => res.end('12345678'));
  await f.request('/api/auth'); await f.request(route + '-other');
  assert.equal(f.reports().length, 0);
  for (let i = 0; i < 3; i++) assert.equal((await f.request(route)).length, 8);
  assert.equal(f.reports().length, 2);
  for (const r of f.reports()) { assert.equal(r.bytes.length, 4); assert.equal(r.metadata.truncated, true); assert.equal(r.metadata.observedBytes, 8); }
});
for (const env of [{ NODE_ENV: 'production' }, { E2E_TEAMS_DEVELOPMENT: 'false' }, { E2E_DATABASE_ISOLATED: 'false' }, { E2E_STATIC_CHUNK_DIAGNOSTICS_DIR: 'relative' }]) test(`guard refuses capture ${JSON.stringify(env)}`, async t => {
  const f = await fixture(t, { env }); f.server.on('request', (req, res) => res.end('normal'));
  assert.equal((await f.request(route)).toString(), 'normal'); assert.equal(f.reports().length, 0);
});
test('aborted response retains partial bytes with incomplete metadata', async t => {
  const f = await fixture(t);
  f.server.on('request', (req, res) => { res.write('partial'); setImmediate(() => res.destroy()); });
  await assert.rejects(f.request(route));
  const [r] = f.reports(); assert.equal(r.metadata.complete, false); assert.equal(r.bytes.toString(), 'partial');
});

test('diagnostic filesystem failure leaves the original response intact', async t => {
  const blocked = path.join(tmpdir(), `chunk-blocked-${process.pid}`);
  writeFileSync(blocked, 'file');
  t.after(() => rmSync(blocked, { force: true }));
  const f = await fixture(t, { env: { E2E_STATIC_CHUNK_DIAGNOSTICS_DIR: path.join(blocked, 'directory') } });
  f.server.on('request', (req, res) => res.end('unchanged'));
  assert.equal((await f.request(route)).toString(), 'unchanged');
});
