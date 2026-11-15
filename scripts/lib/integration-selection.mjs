import { spawnSync } from 'node:child_process';

// Only known documentation changes may skip DB coverage. New runtime roots
// default to full coverage until their dependency edges have been established.
const documentation = /^(?:(?:docs|ee\/docs)\/.*\.(?:md|json|png|svg)|[^/]+\.md)$/;
const graphSource = /^(?:server\/src|packages\/[^/]+\/src|shared)\/.+\.[cm]?[jt]sx?$/;
const outsideGraph = [
  /^(?:server|ee\/server)\/(?:migrations|seeds|test-utils)\//,
  /^server\/(?:vitest\.|src\/test\/setup\.)/,
  /^shared\/.*(?:\/__tests__\/.*)?_dbTestUtils\./,
  /(?:^|\/)(?:package(?:-lock)?\.json|tsconfig[^/]*\.json|vitest[^/]*\.[cm]?[jt]s)$/,
  /^(?:services|ee\/packages|scripts|\.github|test-config)\//,
  /^\.env/,
];

export function selectIntegration(changed) {
  if (changed === null) {
    return { shouldRun: true, full: true, reason: 'Change evidence unavailable; full suite required' };
  }
  if (!Array.isArray(changed) || changed.some((file) => typeof file !== 'string' || !file)) {
    throw new Error('Expected changed paths or null');
  }
  const relevant = changed.filter((file) => !documentation.test(file));
  if (!relevant.length) {
    return { shouldRun: false, full: false, reason: 'Only documentation changed (or identical revisions)' };
  }
  const full = relevant.find((file) => outsideGraph.some((pattern) => pattern.test(file)) || !graphSource.test(file));
  return full
    ? { shouldRun: true, full: true, reason: `${full} is outside the reliable import graph` }
    : { shouldRun: true, full: false, reason: 'Manifest floor plus affected integration suites' };
}

// Selection only needs the two endpoint trees, not history. Shallow CI
// checkouts lack the base commit, so fetch exactly that object on demand
// rather than cloning every branch and tag (which can outrun job timeouts).
function resolveCommit(cwd, revision) {
  const verify = () => spawnSync('git', ['rev-parse', '--verify', '--quiet', '--end-of-options', `${revision}^{commit}`], { cwd, encoding: 'utf8' });
  let result = verify();
  if (result.status !== 0 && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(revision)) {
    spawnSync('git', ['fetch', '--quiet', '--no-tags', '--depth=1', 'origin', revision], { cwd, encoding: 'utf8' });
    result = verify();
  }
  return result.status === 0 ? result.stdout.trim() : null;
}

export function readChangedFiles({ cwd, base, head = 'HEAD' }) {
  if (!base || /^0+$/.test(base)) return null;
  // Pass revisions as verified object IDs to diff; user-controlled refs must
  // never be interpreted as git options.
  const baseCommit = resolveCommit(cwd, base);
  const headCommit = baseCommit && resolveCommit(cwd, head);
  if (!headCommit) return null;
  const result = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', baseCommit, headCommit, '--'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean);
}
