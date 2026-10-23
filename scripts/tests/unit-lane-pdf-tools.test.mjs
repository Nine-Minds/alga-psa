import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Unit suites that shell out to poppler (the label PDF end-to-end suite runs
// `pdftoppm`) fail, by design, when it is absent, and the hosted runner image
// does not ship it. Both unit jobs that can collect such a suite — the Nx
// affected library run and the server unit shards (whose include globs
// ../packages/**) — must install poppler before they run tests.

const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
const SCANNED_ROOTS = ['packages', 'server/src', 'shared', 'ee/packages', 'ee/temporal-workflows/src'];
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const POPPLER_CALL = /['"`](pdftoppm|pdftotext|pdfinfo)['"`]/;

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

function unitSuitesUsingPoppler() {
  const hits = [];
  for (const root of SCANNED_ROOTS) {
    for (const file of walk(path.join(repoRoot, root))) {
      // *.db.test.* and src/test/integration suites run in the integration lane.
      if (/\.db\.test\./.test(file) || file.includes(`${path.sep}test${path.sep}integration${path.sep}`)) continue;
      if (POPPLER_CALL.test(readFileSync(file, 'utf8'))) hits.push(path.relative(repoRoot, file));
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

test('the label PDF end-to-end suite is still discovered as a poppler user', () => {
  assert.ok(
    unitSuitesUsingPoppler().includes('packages/billing/src/lib/label-batch/labelBatch.e2e.test.ts'),
    'scanner no longer sees the known pdftoppm suite; the guard below would be vacuous',
  );
});

for (const [jobId, testCommand] of [
  ['unit-tests', /run: npx nx affected -t test\b/],
  ['server-unit', /run: node scripts\/run-server-unit-shard\.mjs/],
]) {
  test(`${jobId} installs poppler before running unit suites that call it`, () => {
    if (unitSuitesUsingPoppler().length === 0) return;
    const block = jobBlock(jobId);
    assert.ok(block, `unit-tests.yml has no ${jobId} job`);
    const install = block.search(/^\s+uses: \.\/\.github\/actions\/install-poppler\s*$/m);
    const run = block.search(testCommand);
    assert.notEqual(install, -1, `${jobId} does not use ./.github/actions/install-poppler`);
    assert.notEqual(run, -1, `${jobId} test step not found`);
    assert.ok(install < run, `${jobId} installs poppler after its tests run`);
  });
}

test('the install-poppler action installs poppler-utils with bounded apt calls', () => {
  const script = readFileSync(path.join(repoRoot, '.github/actions/install-poppler/action.yml'), 'utf8');
  assert.match(script, /apt-get [^\n]*install -y [^\n]*poppler-utils/);
  for (const line of script.split('\n').filter((l) => /^\s*sudo .*apt-get/.test(l))) {
    assert.match(line, /\btimeout \d+\b/, `unbounded apt call: ${line.trim()}`);
  }
});
