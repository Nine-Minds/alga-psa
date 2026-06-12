#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const TEST_DIR = join(ROOT, 'packages/ui/src/keyboard-shortcuts');
const violations = [];

for (const entry of readdirSync(TEST_DIR, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.contract.test.ts')) {
    continue;
  }

  const file = join(TEST_DIR, entry.name);
  const source = readFileSync(file, 'utf8');
  const grepsSource = source.includes('readFileSync') && source.includes('toContain');
  const hasBehavior =
    /@behavioralCoverage\s+\S+/.test(source) ||
    /\b(render|fireEvent|dispatchShortcut|userEvent)\b/.test(source) ||
    /\.toHaveBeenCalled/.test(source);

  if (grepsSource && !hasBehavior) {
    violations.push(relative(ROOT, file));
  }
}

if (violations.length > 0) {
  console.error('[keyboard-shortcuts-contract-tests] Grep-only contract tests found without behavioral coverage:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

console.log('[keyboard-shortcuts-contract-tests] OK: contract tests have behavioral coverage or explicit behavioral coverage links.');
