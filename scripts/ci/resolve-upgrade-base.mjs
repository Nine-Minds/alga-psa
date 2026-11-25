#!/usr/bin/env node
// Upgrade from the latest main ancestor whose complete safety workflow passed.
// A broken main bootstrap must not prevent a repair PR from being validated.
// The upgrade gate separately checks the current base schema and fresh candidate seeds.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function selectVerifiedBaseline(runs, ancestors, repository) {
  const eligible = new Map();
  for (const run of runs) {
    if (run.event !== 'push' || run.head_branch !== 'main' || run.conclusion !== 'success'
      || run.status !== 'completed' || run.head_repository?.full_name !== repository
      || run.path !== '.github/workflows/ci-safety-gates.yml') continue;
    eligible.set(run.head_sha, run);
  }
  // Git first-parent order, not run completion time: an old rerun is not a new release.
  for (const sha of ancestors) if (eligible.has(sha)) return eligible.get(sha);
  throw new Error('No verified main ancestor found; refusing to guess an upgrade baseline');
}

export function resolveUpgradeBase({ repository, base, cwd = process.cwd() }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GITHUB_REPOSITORY is required');
  if (!/^[a-f0-9]{40}$/.test(base ?? '')) throw new Error('BASE_SHA must be a full commit SHA');
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  git(['merge-base', '--is-ancestor', base, 'origin/main']);
  const ancestors = git(['rev-list', '--first-parent', base]).split('\n');
  // Bound the query; absent recent evidence is an error, never an unverified fallback.
  const response = JSON.parse(execFileSync('gh', ['api',
    `repos/${repository}/actions/workflows/ci-safety-gates.yml/runs?branch=main&event=push&status=success&per_page=100`],
  { cwd, encoding: 'utf8', maxBuffer: 32 << 20 }));
  return selectVerifiedBaseline(response.workflow_runs, ancestors, repository);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const run = resolveUpgradeBase({ repository: process.env.GITHUB_REPOSITORY, base: process.env.BASE_SHA });
    console.error(`Verified upgrade baseline ${run.head_sha}: ${run.html_url}`);
    console.log(run.head_sha);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
