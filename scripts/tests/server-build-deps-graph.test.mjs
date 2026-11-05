import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('server development dependency preparation builds libraries without building the app', () => {
  const nx = new URL('../../node_modules/nx/dist/bin/nx.js', import.meta.url);
  const result = spawnSync(process.execPath, [nx.pathname, 'build-deps', 'server', '--graph=stdout'], {
    cwd: new URL('../..', import.meta.url),
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NX_DAEMON: 'false' },
  });

  assert.equal(result.status, 0, result.stderr);
  const graph = JSON.parse(result.stdout);
  const tasks = Object.keys(graph.tasks.tasks);

  assert.ok(tasks.includes('@alga-psa/co-managed:build'));
  assert.ok(tasks.includes('@alga-psa/billing:build'));
  assert.ok(tasks.includes('@alga-psa/core:build'));
  assert.ok(!tasks.includes('server:build'), 'dependency preparation must not compile the server app');
});
