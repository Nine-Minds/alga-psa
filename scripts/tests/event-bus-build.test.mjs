import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('event-bus build emits runtime entry points without compiling publisher tests', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'alga-event-bus-build-'));
  try {
    const source = path.join(root, 'packages/event-bus');
    const entries = ['index', 'events', 'ticket-live-updates', 'publishers/index', 'publishers/newPublisher', 'workflow/dateDomainEvents'];
    // Drive the production entry selection with isolated modules so this test
    // also runs before any workspace dependency has been built.
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ type: 'module' }));
    for (const entry of entries) {
      const file = path.join(directory, 'src', `${entry}.ts`);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, 'export const publish = (message: string) => message;\n');
    }
    // Exercise the supported test suffixes, including a publisher added after
    // this regression. A test entry must never reach the production compiler.
    for (const suffix of ['test', 'spec', 'test-d']) {
      writeFileSync(path.join(directory, `src/publishers/buildBoundary.${suffix}.ts`),
        "import './test-only-module-that-does-not-exist';\n");
    }

    execFileSync(process.execPath, [
      path.join(root, 'node_modules/tsup/dist/cli-default.js'),
      '--config', path.join(source, 'tsup.config.ts'),
    ], { cwd: directory, stdio: 'pipe', timeout: 60000 });

    for (const entry of entries) {
      assert.ok(existsSync(path.join(directory, 'dist', `${entry}.js`)), `Missing runtime entry: ${entry}`);
    }
    assert.deepEqual(readdirSync(path.join(directory, 'dist/publishers')).sort(), ['index.js', 'newPublisher.js']);
    const publisher = await import(path.join(directory, 'dist/publishers/newPublisher.js'));
    assert.equal(publisher.publish('task comment'), 'task comment');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
