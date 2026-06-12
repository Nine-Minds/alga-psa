#!/usr/bin/env node
/**
 * Guard against silently accumulating skipped tests.
 *
 * Counts `it.skip` / `test.skip` / `describe.skip` / `xit` / `xdescribe`
 * markers in test files and fails when the count exceeds the budget in
 * skip-budget.json. Lowering the budget as skips are fixed is encouraged;
 * raising it requires editing skip-budget.json in the same PR, which makes
 * the change visible in review.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const budgetFile = path.join(repoRoot, 'skip-budget.json');
const { maxSkips } = JSON.parse(readFileSync(budgetFile, 'utf8'));

const SEARCH_ROOTS = ['server/src', 'packages', 'shared', 'ee/server/src', 'ee/temporal-workflows/src'];
const PATTERN = String.raw`\b(it|test|describe)\.skip\b|\bxit\b|\bxdescribe\b`;

let output = '';
try {
  output = execFileSync(
    'grep',
    [
      '-rEn',
      PATTERN,
      '--include=*.test.ts',
      '--include=*.test.tsx',
      '--include=*.test.js',
      '--include=*.spec.ts',
      '--include=*.spec.tsx',
      ...SEARCH_ROOTS,
    ],
    { cwd: repoRoot, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
  );
} catch (err) {
  // grep exits 1 when there are no matches; anything else is a real error.
  if (err.status !== 1) throw err;
}

const matches = output.split('\n').filter(Boolean);
console.log(`Skipped-test markers found: ${matches.length} (budget: ${maxSkips})`);

if (matches.length > maxSkips) {
  console.error('\nSkip budget exceeded. New skipped tests:');
  for (const line of matches) console.error(`  ${line}`);
  console.error(
    `\nEither un-skip tests to get back under the budget, or raise maxSkips in skip-budget.json ` +
      `in this PR with a justification.`
  );
  process.exit(1);
}

if (matches.length < maxSkips) {
  console.log(
    `Budget can be lowered: set maxSkips to ${matches.length} in skip-budget.json to lock in the improvement.`
  );
}
