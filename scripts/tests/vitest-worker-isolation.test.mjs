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

// Vitest forwards only a whitelist of CLI options into project configs, and
// poolOptions is not on it: once server/vitest.config.ts grew jsdom/node
// projects, --poolOptions.forks.singleFork=false stopped reaching the workers
// and every caller silently lost its fresh-fork-per-file guarantee. The config
// reads VITEST_RECYCLE_FORKS instead (server/package.json's `test` script and
// unit-tests.yml's calendar-timezone step set it). Pin both halves so a revert
// to the CLI form fails here instead of quietly serializing CI into one fork.
test('under projects only the env switch recycles workers', { timeout: 30000 }, (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'alga-unit-isolation-projects-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(path.join(root, 'vitest.config.mjs'), `
    const singleFork = process.env.VITEST_RECYCLE_FORKS !== '1';
    const base = { globals: true, include: ['*.test.js'], fileParallelism: false, maxWorkers: 1,
      isolate: true, pool: 'forks', poolOptions: { forks: { singleFork } } };
    export default { test: { ...base, projects: [{ test: { ...base, name: 'node' } }] } };
  `);
  for (const name of ['first', 'second']) {
    writeFileSync(path.join(root, `${name}.test.js`), `
      import { writeFileSync } from 'node:fs';
      test('records its own runtime', () => {
        writeFileSync(${JSON.stringify(path.join(root, name + '.pid'))}, String(process.pid));
        expect(2 + 2).toBe(4);
      });
    `);
  }
  const run = (overrides, env = {}) => {
    for (const file of readdirSync(root).filter((name) => name.endsWith('.pid'))) {
      rmSync(path.join(root, file));
    }
    const result = spawnSync(process.execPath, [vitest, 'run', ...overrides], {
      cwd: root, env: { ...process.env, CI: '1', ...env }, encoding: 'utf8', timeout: 20000,
    });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const pids = readdirSync(root).filter((file) => file.endsWith('.pid')).map((file) => readFileSync(path.join(root, file), 'utf8'));
    assert.equal(pids.length, 2, `both files must run: ${result.stdout}`);
    return new Set(pids).size;
  };
  assert.equal(run(['--poolOptions.forks.singleFork=false', '--maxWorkers=1']), 1,
    'the CLI override does not reach project workers — callers must not rely on it');
  assert.equal(run(['--maxWorkers=1'], { VITEST_RECYCLE_FORKS: '1' }), 2,
    'VITEST_RECYCLE_FORKS must recycle the process between files');
});
