import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { imageInputsHash, loadImagePolicy, selectImageInputs } from '../lib/image-inputs.mjs';

const policy = { schemaVersion: 1, exclude: ['docs/', 'e2e-tests/', 'README.md'], always: ['.github/workflows/e2e.yaml', 'scripts/image-inputs.json'],
  images: { server: { dockerfile: 'Dockerfile.build', include: [] }, redis: { dockerfile: 'redis/Dockerfile', include: ['redis/'] } } };

test('input selection honors includes, excludes, the dockerfile and the always list', () => {
  const files = ['Dockerfile.build', 'redis/Dockerfile', 'redis/entrypoint.sh', 'server/index.ts', 'docs/a.md', 'README.md', 'e2e-tests/x.spec.ts', '.github/workflows/e2e.yaml', 'scripts/image-inputs.json'];
  assert.deepEqual(selectImageInputs({ files, policy, service: 'server' }), ['Dockerfile.build', 'redis/Dockerfile', 'redis/entrypoint.sh', 'server/index.ts', '.github/workflows/e2e.yaml', 'scripts/image-inputs.json']);
  assert.deepEqual(selectImageInputs({ files, policy, service: 'redis' }), ['redis/Dockerfile', 'redis/entrypoint.sh', '.github/workflows/e2e.yaml', 'scripts/image-inputs.json']);
  assert.throws(() => selectImageInputs({ files, policy, service: 'unknown' }), /No image inputs policy/);
});

test('hashes are stable across unrelated commits and change with any input blob', (t) => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'image-inputs-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file, content) => { mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true }); writeFileSync(path.join(cwd, file), content); };
  git('init', '-q'); git('config', 'user.name', 'fixture'); git('config', 'user.email', 'fixture@example.invalid');
  write('Dockerfile.build', 'FROM scratch\n'); write('redis/Dockerfile', 'FROM redis\n'); write('redis/entrypoint.sh', 'echo\n');
  write('server/index.ts', 'export {}\n'); write('docs/a.md', 'docs\n'); write('.github/workflows/e2e.yaml', 'x\n'); write('scripts/image-inputs.json', '{}\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  write('docs/a.md', 'changed docs\n'); write('e2e-tests/x.spec.ts', 'test\n'); git('add', '.'); git('commit', '-qm', 'docs and e2e only');
  const docsOnly = git('rev-parse', 'HEAD');
  write('server/index.ts', 'export const changed = 1\n'); git('add', '.'); git('commit', '-qm', 'server change');
  const serverChange = git('rev-parse', 'HEAD');
  const hash = (revision, service) => imageInputsHash({ cwd, revision, service, policy });
  assert.equal(hash(base, 'server').sha256, hash(docsOnly, 'server').sha256, 'docs and e2e changes are not image inputs');
  assert.equal(hash(base, 'redis').sha256, hash(serverChange, 'redis').sha256, 'a server change leaves redis inputs identical');
  assert.notEqual(hash(base, 'server').sha256, hash(serverChange, 'server').sha256);
  assert.equal(hash(base, 'redis').files, 4);
  write('scripts/image-inputs.json', '{"changed":true}\n'); git('add', '.'); git('commit', '-qm', 'policy change');
  assert.notEqual(hash(serverChange, 'redis').sha256, hash(git('rev-parse', 'HEAD'), 'redis').sha256, 'the policy file is an input to every image');
});

test('the committed policy covers every fresh-install image and its Dockerfile', () => {
  const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
  const committed = loadImagePolicy(root);
  assert.deepEqual(Object.keys(committed.images).sort(), ['algasim', 'email-service', 'hocuspocus', 'pgbouncer', 'redis', 'server', 'server-ee', 'setup', 'temporal-worker', 'workflow-worker']);
  for (const [service, image] of Object.entries(committed.images)) assert.ok(image.dockerfile && Array.isArray(image.include), service);
});
