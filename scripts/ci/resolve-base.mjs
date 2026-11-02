#!/usr/bin/env node
// Resolve the baseline commit the CI safety gates diff against (alga-2026-0002848).
//
//   node scripts/ci/resolve-base.mjs [--repo <dir>]
//
// Reads the GitHub event from the environment:
//   EVENT_NAME      github.event_name
//   PR_BASE_SHA     github.event.pull_request.base.sha
//   PR_HEAD_SHA     github.event.pull_request.head.sha
//   PUSH_BEFORE_SHA github.event.before
// and prints the baseline SHA (empty when there is none, e.g. a new branch push).
//
// On pull_request, actions/checkout checks out refs/pull/N/merge: a merge commit of
// the PR head (second parent) into the base branch tip (first parent). GitHub rebuilds
// that ref whenever the base branch moves, but pull_request.base.sha only updates when
// the PR itself is synchronized. Diffing the merge commit against the stale base.sha
// attributes every commit that landed on main since the last PR push to the PR. The
// merge commit's first parent is exactly the base content the checkout contains, so
// that is the baseline whenever the checkout is that merge.

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ZERO_SHA = /^0+$/;

function gitIn(repo) {
  return (args) => {
    try {
      return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return null;
    }
  };
}

export function resolveBase({ eventName, prBaseSha, prHeadSha, pushBeforeSha }, repo) {
  const git = gitIn(repo);
  if (eventName === 'pull_request' || eventName === 'pull_request_target') {
    const parents = (git(['rev-list', '--parents', '-n', '1', 'HEAD']) ?? '').split(/\s+/).slice(1);
    const isPrMergeRef = parents.length === 2 && !!prHeadSha && parents[1] === git(['rev-parse', '--verify', `${prHeadSha}^{commit}`]);
    if (isPrMergeRef) return parents[0];
    return prBaseSha || '';
  }
  if (!pushBeforeSha || ZERO_SHA.test(pushBeforeSha)) return '';
  return pushBeforeSha;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const repoIdx = argv.indexOf('--repo');
  const repo = repoIdx >= 0 ? path.resolve(argv[repoIdx + 1]) : process.cwd();
  const { EVENT_NAME, PR_BASE_SHA, PR_HEAD_SHA, PUSH_BEFORE_SHA } = process.env;
  process.stdout.write(`${resolveBase({
    eventName: EVENT_NAME,
    prBaseSha: PR_BASE_SHA,
    prHeadSha: PR_HEAD_SHA,
    pushBeforeSha: PUSH_BEFORE_SHA,
  }, repo)}\n`);
}
