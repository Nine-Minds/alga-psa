#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVICE_ROOT = path.resolve(__dirname, '..');
const DIST_ROOT = path.resolve(
  process.env.WORKFLOW_WORKER_VALIDATE_DIST_ROOT || path.join(SERVICE_ROOT, 'dist'),
);

const ENTRY_CANDIDATES = [
  path.join(DIST_ROOT, 'services/workflow-worker/src/index.js'),
  path.join(DIST_ROOT, 'src/index.js'),
];

const FORBIDDEN_ROOT_IMPORTS = new Set([
  '@alga-psa/auth',
  '@alga-psa/documents',
  '@alga-psa/integrations',
  '@alga-psa/billing',
  '@alga-psa/ui',
]);

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function findEntry() {
  for (const candidate of ENTRY_CANDIDATES) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function extractSpecifiers(source) {
  const specs = [];

  const staticImportRe = /(?:import|export)\s+(?:[^'"]*?\sfrom\s*)?['"]([^'"]+)['"]/g;
  const dynamicImportRe = /import\(\s*['"]([^'"]+)['"]\s*\)/g;

  for (const re of [staticImportRe, dynamicImportRe]) {
    let match;
    while ((match = re.exec(source)) !== null) {
      specs.push(match[1]);
    }
  }

  return specs;
}

function resolveRelativeImport(fromFile, specifier) {
  const fromDir = path.dirname(fromFile);
  const rawPath = path.resolve(fromDir, specifier);
  if (fs.existsSync(rawPath) && fs.statSync(rawPath).isFile()) {
    return rawPath;
  }

  const candidates = [
    `${rawPath}.js`,
    `${rawPath}.mjs`,
    `${rawPath}.cjs`,
    `${rawPath}.json`,
    path.join(rawPath, 'index.js'),
    path.join(rawPath, 'index.mjs'),
    path.join(rawPath, 'index.cjs'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function isRelative(specifier) {
  return specifier.startsWith('./') || specifier.startsWith('../');
}

function isPathWithin(basePath, candidatePath) {
  const rel = path.relative(basePath, candidatePath);
  return rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function addViolation(violations, filePath, specifier, reason) {
  violations.push({
    filePath: path.relative(SERVICE_ROOT, filePath),
    specifier,
    reason,
  });
}

function isWorkerRuntimeEntrypoint(filePath) {
  return filePath.endsWith(path.join('ee', 'packages', 'workflows', 'src', 'runtime', 'worker.js'));
}

function validate() {
  if (!fs.existsSync(DIST_ROOT)) {
    throw new Error(`dist not found at ${DIST_ROOT}`);
  }

  const entry = findEntry();
  if (!entry) {
    throw new Error('Unable to locate workflow-worker dist entrypoint');
  }

  const queue = [entry];
  const visited = new Set();
  const violations = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const source = readFile(current);
    const specifiers = extractSpecifiers(source);

    for (const specifier of specifiers) {
      if (FORBIDDEN_ROOT_IMPORTS.has(specifier)) {
        addViolation(
          violations,
          current,
          specifier,
          'forbidden package root import in worker runtime graph'
        );
      }

      if (specifier.startsWith('@alga-psa/ui/')) {
        addViolation(
          violations,
          current,
          specifier,
          'ui package import is not allowed in worker runtime graph'
        );
      }

      if (specifier.startsWith('@shared/')) {
        addViolation(
          violations,
          current,
          specifier,
          'unresolved @shared alias is not allowed in worker runtime graph'
        );
      }

      if (specifier.includes('/runtime/bootstrap')) {
        addViolation(
          violations,
          current,
          specifier,
          'bootstrap/app-only runtime dependency leaked into worker runtime graph'
        );
      }

      if (
        (specifier.includes('workflowInferenceService') || specifier.includes('registerAiActions'))
        && !isWorkerRuntimeEntrypoint(current)
      ) {
        addViolation(
          violations,
          current,
          specifier,
          'worker runtime graph may only reach AI runtime wiring through the dedicated runtime/worker entrypoint'
        );
      }

      if (
        specifier.includes('/components/') ||
        specifier.endsWith('/components')
      ) {
        addViolation(
          violations,
          current,
          specifier,
          'component import leaked into worker runtime graph'
        );
      }

      if (!isRelative(specifier)) {
        continue;
      }

      const ext = path.extname(specifier);
      if (!ext) {
        addViolation(
          violations,
          current,
          specifier,
          'relative import is missing explicit extension'
        );
      } else if (ext === '.jsx') {
        addViolation(
          violations,
          current,
          specifier,
          'relative .jsx import is not allowed for Node worker runtime'
        );
      }

      const resolved = resolveRelativeImport(current, specifier);
      if (!resolved) {
        addViolation(
          violations,
          current,
          specifier,
          'relative import does not resolve in dist output'
        );
        continue;
      }

      if (resolved.endsWith('.jsx')) {
        addViolation(
          violations,
          current,
          specifier,
          'resolved path is .jsx, which is not executable by Node runtime here'
        );
      }

      if (isPathWithin(DIST_ROOT, resolved)) {
        queue.push(resolved);
      }
    }
  }

  if (violations.length > 0) {
    console.error('\nWorkflow worker runtime import validation failed.\n');
    for (const violation of violations) {
      console.error(`- ${violation.filePath} -> "${violation.specifier}"`);
      console.error(`  ${violation.reason}`);
    }
    process.exit(1);
  }

  console.log('Workflow worker runtime import validation passed.');
}

try {
  validate();
} catch (error) {
  console.error('\nWorkflow worker runtime import validation failed.\n');
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
