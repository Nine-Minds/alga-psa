import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The collaboration server (hocuspocus/) is not an npm workspace: its locked
// dependencies live in hocuspocus/node_modules and only exist after
// `npm ci --prefix hocuspocus`. Unit suites that drive the real installed
// Hocuspocus server (the ticket live-update relay authorization tests) import
// from there, so every unit job that can collect such a suite — the Nx affected
// library run and the server unit shards — must install it before its tests.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED_ROOTS = ['packages', 'server/src', 'shared', 'ee/packages', 'ee/temporal-workflows/src'];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const HOCUSPOCUS_INSTALL_IMPORT = /['"`](?:\.\.\/)+hocuspocus\/node_modules\//;

function* walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (TEST_FILE.test(entry.name)) yield full;
  }
}

function unitSuitesUsingHocuspocusInstall() {
  const hits = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(path.join(repoRoot, root))) {
      // *.db.test.* and src/test/integration suites run in the integration lane.
      if (/\.db\.test\./.test(file) || file.includes(`${path.sep}test${path.sep}integration${path.sep}`)) continue;
      if (HOCUSPOCUS_INSTALL_IMPORT.test(readFileSync(file, 'utf8'))) hits.push(path.relative(repoRoot, file));
    }
  }
  return hits;
}

// Runs in the skip-budget job, which has no node_modules, so the workflow is
// sliced by indentation instead of parsed: a job is the block under `  <id>:`.
const workflow = readFileSync(path.join(repoRoot, '.github/workflows/unit-tests.yml'), 'utf8');

function jobBlock(jobId) {
  const lines = workflow.split('\n');
  const start = lines.indexOf(`  ${jobId}:`);
  if (start === -1) return null;
  const end = lines.findIndex((line, i) => i > start && /^  \S/.test(line));
  return lines.slice(start, end === -1 ? undefined : end).join('\n');
}

test('the ticket live-update relay suite is still discovered as a hocuspocus install user', () => {
  assert.ok(
    unitSuitesUsingHocuspocusInstall().includes('server/src/test/unit/hocuspocus/TicketUpdatesExtension.test.ts'),
    'scanner no longer sees the known hocuspocus/node_modules suite; the guard below would be vacuous',
  );
});

for (const [jobId, testCommand] of [
  ['unit-tests', /run: npx nx affected -t test\b/],
  ['server-unit', /run: node scripts\/run-server-unit-shard\.mjs/],
]) {
  test(`${jobId} installs the locked collaboration server before running suites that import it`, () => {
    if (unitSuitesUsingHocuspocusInstall().length === 0) return;
    const block = jobBlock(jobId);
    assert.ok(block, `unit-tests.yml has no ${jobId} job`);
    const install = block.search(/^\s+run: npm ci --prefix hocuspocus\b/m);
    const run = block.search(testCommand);
    assert.notEqual(install, -1, `${jobId} does not run npm ci --prefix hocuspocus`);
    assert.notEqual(run, -1, `${jobId} test step not found`);
    assert.ok(install < run, `${jobId} installs the collaboration server after its tests run`);
  });
}
