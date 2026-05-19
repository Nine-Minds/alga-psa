#!/usr/bin/env node

/**
 * Keeps the shared keyboard shortcut engine dependency-light.
 *
 * Usage:
 *   node scripts/guard-keyboard-shortcuts-boundary.mjs
 *   node scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const ENGINE_DIR = getFlag('--engine-dir') ?? join(ROOT, 'packages/ui/src/keyboard-shortcuts');

const FORBIDDEN_IMPORTS = [
  '@alga-psa/user-composition',
  '@alga-psa/assets',
  '@alga-psa/billing',
  '@alga-psa/clients',
  '@alga-psa/projects',
  '@alga-psa/scheduling',
  '@alga-psa/tickets',
];

function getFlag(flag) {
  const index = process.argv.indexOf(flag);
  return index !== -1 && index + 1 < process.argv.length ? process.argv[index + 1] : null;
}

function collectSourceFiles(dir) {
  const files = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(abs));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(abs);
    }
  }

  return files;
}

function extractModuleSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /\bimport\s+(?:type\s+)?(?:[^'"]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:type\s+)?[^'"]+\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      specifiers.push(match[1]);
    }
  }

  return specifiers;
}

function isForbidden(specifier) {
  return FORBIDDEN_IMPORTS.some((forbidden) => specifier === forbidden || specifier.startsWith(`${forbidden}/`));
}

const violations = [];

for (const file of collectSourceFiles(ENGINE_DIR)) {
  const source = readFileSync(file, 'utf8');
  for (const specifier of extractModuleSpecifiers(source)) {
    if (isForbidden(specifier)) {
      violations.push(`${relative(ROOT, file)} imports ${specifier}`);
    }
  }
}

if (violations.length > 0) {
  console.error('[keyboard-shortcuts-boundary] Forbidden imports found:');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  process.exit(1);
}

const graphPath = getFlag('--graph');
if (graphPath) {
  const result = spawnSync(
    process.execPath,
    ['scripts/check-circular-deps.mjs', graphPath, '--baseline', '.github/known-cycles.json'],
    { cwd: ROOT, stdio: 'inherit' },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log('[keyboard-shortcuts-boundary] OK: no forbidden engine imports or new circular dependencies.');
