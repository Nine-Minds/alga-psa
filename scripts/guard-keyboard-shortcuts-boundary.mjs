#!/usr/bin/env node

/**
 * Keeps the shared keyboard shortcut engine dependency-light.
 *
 * Usage:
 *   node scripts/guard-keyboard-shortcuts-boundary.mjs
 *   node scripts/guard-keyboard-shortcuts-boundary.mjs --graph /tmp/project-graph.json
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const ENGINE_DIR = getFlag('--engine-dir') ?? join(ROOT, 'packages/ui/src/keyboard-shortcuts');
const DEFAULT_REGISTRATION_FILES = [
  'server/src/components/search/SearchPalette.tsx',
  'server/src/components/layout/DefaultLayout.tsx',
  'server/src/context/DrawerContext.tsx',
  'packages/ui/src/context/DrawerContext.tsx',
  'packages/tickets/src/components/ticket/TicketNavigation.tsx',
  'packages/assets/src/components/AssetDashboardClient.tsx',
  'packages/billing/src/components/invoice-designer/hooks/useDesignerShortcuts.ts',
];

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

function getFlags(flag) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === flag && index + 1 < process.argv.length) {
      values.push(process.argv[index + 1]);
    }
  }
  return values;
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

const catalogSourcePath = join(ROOT, 'packages/ui/src/keyboard-shortcuts/catalog.ts');
const catalogSource = existsSync(catalogSourcePath) ? readFileSync(catalogSourcePath, 'utf8') : '';
const catalogIds = new Set(Array.from(catalogSource.matchAll(/entry\(\s*'([^']+)'/g), (match) => match[1]));
const registrationFiles = getFlags('--registration-file');
const filesToCheck = (registrationFiles.length > 0 ? registrationFiles : DEFAULT_REGISTRATION_FILES)
  .map((file) => (file.startsWith('/') ? file : join(ROOT, file)))
  .filter((file) => existsSync(file));
const driftViolations = [];

for (const file of filesToCheck) {
  const source = readFileSync(file, 'utf8');
  for (const token of ['defaultBindings:', 'labelKey:', 'groupKey:', 'scope:', 'priority:', 'sequence:', 'allowInEditable:']) {
    if (source.includes(token)) {
      driftViolations.push(`${relative(ROOT, file)} hand-authors shortcut metadata token ${token}`);
    }
  }

  for (const match of source.matchAll(/\b(?:useCatalogShortcut|createShortcutAction)\(\s*['"]([^'"]+)['"]/g)) {
    if (!catalogIds.has(match[1])) {
      driftViolations.push(`${relative(ROOT, file)} references shortcut action ${match[1]} not present in catalog`);
    }
  }
}

if (driftViolations.length > 0) {
  console.error('[keyboard-shortcuts-boundary] Catalog drift found:');
  for (const violation of driftViolations) {
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

console.log('[keyboard-shortcuts-boundary] OK: no forbidden engine imports, catalog drift, or new circular dependencies.');
