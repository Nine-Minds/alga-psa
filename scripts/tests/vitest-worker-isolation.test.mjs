import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vitest = fileURLToPath(new URL('../../server/node_modules/vitest/vitest.mjs', import.meta.url));

test('full-unit CLI override gives each file a fresh worker', { timeout: 30000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-unit-isolation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'), `export default ${JSON.stringify({ test: {
    globals: true, include: ['*.test.js'], fileParallelism: false, maxWorkers: 1,
    isolate: true, pool: 'forks', poolOptions: { forks: { singleFork: true } },
  } })};`);
  for (const name of ['first', 'second']) {
    writeFileSync(path.join(root, `${name}.test.js`), `
      import { writeFileSync } from 'node:fs';
      test('records its own runtime', () => {
        writeFileSync(${JSON.stringify(path.join(root, name + '.pid'))}, String(process.pid));
        expect(2 + 2).toBe(4);
      });
    `);
  }
  const run = (overrides) => {
    const result = spawnSync(process.execPath, [vitest, 'run', ...overrides], {
      cwd: root, env: { ...process.env, CI: '1' }, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const pids = readdirSync(root).filter((file) => file.endsWith('.pid')).map((file) => readFileSync(path.join(root, file), 'utf8'));
    assert.equal(pids.length, 2);
    return new Set(pids).size;
  };
  assert.equal(run([]), 1, 'the inherited singleFork setting reuses its process across files');
  assert.equal(run(['--poolOptions.forks.singleFork=false', '--maxWorkers=1']), 2,
    'the full-unit override must recycle the process between files');
});
