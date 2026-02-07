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

async function importModule(absPath) {
  await import(pathToFileURL(absPath).href);
}

async function main() {
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
  console.log('Temporal worker dist import smoke check passed.');
}

main().catch((error) => {
  console.error('\nTemporal worker dist import smoke check failed.\n');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
