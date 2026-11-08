import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { productionSourceFiles } from '../lib/production-source-files.mjs';

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'production-source-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (file, content = file) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  };
  return { root, write };
}

test('a native build tree can disappear between discovery and reading without affecting source coverage', t => {
  const { root, write } = fixture(t);
  write('packages/predicates/src/conformance.ts', 'production');
  write('packages/predicates/.native-runtime-fixture/src/conformance.ts', 'scratch');
  write('packages/clients/src/actions/newWriter.tsx', 'new writer');

  const files = productionSourceFiles(root, ['packages']);
  rmSync(path.join(root, 'packages/predicates/.native-runtime-fixture'), { recursive: true });

  assert.deepEqual(files, [
    'packages/clients/src/actions/newWriter.tsx',
    'packages/predicates/src/conformance.ts',
  ]);
  assert.deepEqual(files.map(file => readFileSync(path.join(root, file), 'utf8')), ['new writer', 'production']);
});

test('discovers nested TS and TSX sources once, excluding dependencies, output, tests and declarations', t => {
  const { root, write } = fixture(t);
  const sources = ['packages/example/src/a.ts', 'packages/example/src/nested/b.tsx',
    'packages/example/migrations/migrate.ts', 'packages/example/seeds/seed.ts'];
  for (const file of sources) write(file);
  for (const directory of ['node_modules', 'dist', 'generated', '__tests__', 'test', 'tests', 'test-utils', '.next', '.scratch']) {
    write(`packages/example/${directory}/nested/ignored.ts`);
  }
  for (const file of ['a.test.ts', 'b.test.tsx', 'c.d.ts', 'd.d.tsx', 'e.js', 'f.json']) {
    write(`packages/example/src/${file}`);
  }
  assert.deepEqual(productionSourceFiles(root, ['packages', 'packages/example/src', 'missing']), sources.sort());
});

test('ignores dangling symlinks, directory loops and source links outside the scan roots', t => {
  const { root, write } = fixture(t);
  write('packages/example/src/writer.ts');
  write('outside.ts');
  const directory = path.join(root, 'packages/example');
  symlinkSync(path.join(root, 'missing'), path.join(directory, 'dangling.ts'));
  symlinkSync(directory, path.join(directory, 'loop'), 'dir');
  symlinkSync(path.join(root, 'outside.ts'), path.join(directory, 'outside.ts'));
  assert.deepEqual(productionSourceFiles(root, ['packages']), ['packages/example/src/writer.ts']);
});

test('fails on invalid source roots rather than silently returning an incomplete inventory', t => {
  const { root, write } = fixture(t);
  write('packages/not-a-directory.ts');
  assert.throws(() => productionSourceFiles(root, ['packages/not-a-directory.ts']), { code: 'ENOTDIR' });
});
