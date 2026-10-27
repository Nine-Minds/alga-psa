import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The server's v8 coverage provider decides which files to report through
// test-exclude, once per covered file per (project, environment) and again for
// every file on disk when it looks for untested ones. Vitest appends each test
// include to coverage.exclude, and a server-unit shard's include is an explicit
// list of ~965 files (relative, so they never match the absolute paths
// allowExternal compares — they only cost), so every decision walks ~2000
// patterns. Unpatched,
// test-exclude recompiled each pattern on every call and a shard spent 11-22
// minutes generating coverage — past the job timeout. patches/test-exclude+*.patch
// compiles each pattern once; this pins that behaviour on the copy the provider
// actually loads.
const root = fileURLToPath(new URL('../../', import.meta.url));
const server = path.join(root, 'server');
const providerRequire = createRequire(path.join(server, 'node_modules/@vitest/coverage-v8/package.json'));
const testExcludePath = providerRequire.resolve('test-exclude');
const TestExclude = providerRequire(testExcludePath);
const { Minimatch } = createRequire(testExcludePath)('minimatch');

function countCompilations(t) {
  const make = Minimatch.prototype.make;
  let count = 0;
  Minimatch.prototype.make = function countedMake(...args) {
    count += 1;
    return make.apply(this, args);
  };
  t.after(() => { Minimatch.prototype.make = make; });
  return () => count;
}

// Shaped like the provider's TestExclude for a server-unit shard:
// absolute include globs (allowExternal), default-style excludes, then the
// shard's assigned test files appended by vitest.
function shardTestExclude(assignedTests) {
  return new TestExclude({
    cwd: server,
    include: [
      `${server}/src/**/*.{js,ts,jsx,tsx}`,
      `${path.join(root, 'packages')}/*/src/**/*.{js,ts,jsx,tsx}`,
      `${path.join(root, 'shared')}/**/*.{js,ts,jsx,tsx}`,
    ],
    exclude: [
      '**/*{.,-}{test,spec,bench,benchmark}?(-d).?(c|m)[jt]s?(x)',
      '**/{vitest,vite,jest}.config.*',
      '**/dist/**',
      '**/node_modules/**',
      '**/*.generated.ts',
      ...assignedTests,
    ],
    excludeNodeModules: true,
    extension: ['.js', '.ts', '.jsx', '.tsx'],
    relativePath: false,
  });
}

test('coverage include decisions are unchanged by the compiled-pattern cache', () => {
  const assigned = ['src/test/unit/fixtures/listed.ts', '../packages/db/src/lib/listed-helper.ts'];
  const exclude = shardTestExclude(assigned);
  const decide = (file) => exclude.shouldInstrument(path.resolve(server, file));
  // test-exclude's own rule, compiling per call as upstream does.
  const { minimatch } = createRequire(testExcludePath)('minimatch');
  const upstream = (file) => {
    const matches = (pattern) => minimatch(path.resolve(server, file), pattern, { dot: true });
    return exclude.extension.some((ext) => file.endsWith(ext))
      && exclude.include.some(matches)
      && (!exclude.exclude.some(matches) || exclude.excludeNegated.some(matches));
  };

  const cases = {
    'src/lib/actions/ticket.ts': true,
    '../packages/db/src/lib/tenantTableManifest.ts': true,
    '../shared/models/ticketModel.ts': true,
    '../packages/db/src/lib/afterCommit.test.ts': false,
    '../packages/db/dist/index.js': false,
    '../packages/db/src/node_modules/dep/index.js': false,
    '../packages/db/src/lib/schema.json': false,
    '../ee/server/src/lib/thing.ts': false,
    // Vitest's appended includes are relative while allowExternal matches
    // absolute paths, so they exclude nothing — before and after the cache.
    'src/test/unit/fixtures/listed.ts': true,
  };
  for (const [file, expected] of Object.entries(cases)) {
    assert.equal(decide(file), expected, file);
    assert.equal(decide(file), upstream(file), `${file} matches upstream test-exclude`);
  }
});

test('each coverage pattern is compiled once, not once per covered file', (t) => {
  const assigned = Array.from({ length: 965 }, (_, i) => `../packages/pkg${i % 40}/src/feature${i}.test.ts`);
  const exclude = shardTestExclude(assigned);
  const patterns = exclude.include.length + exclude.exclude.length + exclude.excludeNegated.length;
  const files = Array.from({ length: 300 }, (_, i) => path.join(root, `packages/pkg${i % 40}/src/module${i}.ts`));
  const compilations = countCompilations(t);

  for (const file of files) assert.equal(exclude.shouldInstrument(file), true);
  assert.ok(compilations() <= patterns,
    `first pass compiled ${compilations()} matchers for ${patterns} patterns over ${files.length} files`);

  const afterFirstPass = compilations();
  for (const file of files) exclude.shouldInstrument(file);
  assert.equal(compilations(), afterFirstPass, 'repeat decisions reuse the compiled matchers');
});
