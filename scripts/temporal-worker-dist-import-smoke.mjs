#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = process.cwd();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}`);
  }
}

function findExistingPath(candidates) {
  for (const relPath of candidates) {
    const absPath = path.join(REPO_ROOT, relPath);
    if (fs.existsSync(absPath)) return absPath;
  }
  return null;
}

function ensureEventSchemasDistBuilt() {
  const distIndex = path.join(REPO_ROOT, 'packages/event-schemas/dist/index.js');
  if (fs.existsSync(distIndex)) {
    return;
  }

  console.log('Building packages/event-schemas for dist import smoke test...');
  run('npm', ['--prefix', 'packages/event-schemas', 'run', 'build']);
}

function buildWorkspaceIfScriptExists(relPath) {
  const pkgPath = path.join(REPO_ROOT, relPath, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (!pkg.scripts?.build) {
    return;
  }

  console.log(`Building ${relPath} for dist import smoke test...`);
  run('npm', ['--prefix', relPath, 'run', 'build']);
}

async function importModule(absPath) {
  await import(pathToFileURL(absPath).href);
}

async function assertMarketingRuntimeExports() {
  const posts = await import('@alga-psa/marketing/lib/posts');
  const sequences = await import('@alga-psa/marketing/lib/sequences');
  const requiredExports = [
    ['flipDuePostsInternal', posts.flipDuePostsInternal],
    ['expireStaleTargetsInternal', posts.expireStaleTargetsInternal],
    ['sendDueSequenceStepsInternal', sequences.sendDueSequenceStepsInternal],
  ];

  for (const [name, value] of requiredExports) {
    if (typeof value !== 'function') {
      throw new Error(`@alga-psa/marketing runtime export ${name} is missing`);
    }
  }
}

async function main() {
  // The Temporal worker statically references the job handlers in @alga-psa/jobs,
  // which fan out across the vertical domain packages (billing/tickets/integrations/
  // ...). All of their dist must exist before the worker bundle is imported below,
  // so build every @alga-psa workspace package. Foundation first (a few have
  // build-time ordering needs); the rest externalize @alga-psa/* so order is moot.
  const FOUNDATION = [
    'packages/core',
    'packages/types',
    'packages/event-bus',
    'packages/validation',
    'packages/db',
    // shared imports @alga-psa/authorization/{kernel,bundles/service} and resolves
    // them from packages/authorization/dist at runtime, so build it before shared.
    'packages/authorization',
  ];
  const workspacePkgs = ['packages', 'ee/packages'].flatMap((root) => {
    const rootAbs = path.join(REPO_ROOT, root);
    if (!fs.existsSync(rootAbs)) return [];
    return fs
      .readdirSync(rootAbs)
      .map((name) => `${root}/${name}`)
      .filter((rel) => fs.existsSync(path.join(REPO_ROOT, rel, 'package.json')));
  });
  for (const relPath of FOUNDATION) {
    buildWorkspaceIfScriptExists(relPath);
  }
  for (const relPath of workspacePkgs.filter((p) => !FOUNDATION.includes(p))) {
    try {
      buildWorkspaceIfScriptExists(relPath);
    } catch (err) {
      // Some workspace packages are empty stubs (tsup "No input files") or simply
      // aren't on the worker's import path. Skip their build failures here; if the
      // worker actually needs a package's dist, the dist-import step below fails loudly.
      console.warn(`Skipping build for ${relPath}: ${err.message}`);
    }
  }
  console.log('Building shared for dist import smoke test...');
  run('npm', ['--prefix', 'shared', 'run', 'build']);
  console.log('Building ee/temporal-workflows for dist import smoke test...');
  run('npm', ['--prefix', 'ee/temporal-workflows', 'run', 'build']);
  ensureEventSchemasDistBuilt();

  const workerEntry = findExistingPath([
    'ee/temporal-workflows/dist/worker.js',
    'ee/temporal-workflows/dist/src/worker.js',
    'ee/temporal-workflows/dist/ee/temporal-workflows/src/worker.js',
  ]);
  const activitiesEntry = findExistingPath([
    'ee/temporal-workflows/dist/activities/index.js',
    'ee/temporal-workflows/dist/src/activities/index.js',
    'ee/temporal-workflows/dist/ee/temporal-workflows/src/activities/index.js',
  ]);
  const workflowsEntry = findExistingPath([
    'ee/temporal-workflows/dist/workflows/index.js',
    'ee/temporal-workflows/dist/src/workflows/index.js',
    'ee/temporal-workflows/dist/ee/temporal-workflows/src/workflows/index.js',
  ]);

  const required = [
    ['worker', workerEntry],
    ['activities', activitiesEntry],
    ['workflows', workflowsEntry],
  ];

  for (const [label, modulePath] of required) {
    if (!modulePath) {
      throw new Error(`Could not locate built ${label} entry in dist output`);
    }
  }

  console.log('Importing built worker modules...');
  await importModule(workerEntry);
  await importModule(activitiesEntry);
  await importModule(workflowsEntry);
  await assertMarketingRuntimeExports();
  console.log('Temporal worker dist import smoke check passed.');
}

main().catch((error) => {
  console.error('\nTemporal worker dist import smoke check failed.\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
