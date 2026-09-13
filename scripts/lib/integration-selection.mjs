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

export function readChangedFiles({ cwd, base, head = 'HEAD' }) {
  if (!base || /^0+$/.test(base)) return null;
  for (const revision of [base, head]) {
    // Pass revisions as verified object IDs to diff; user-controlled refs must
    // never be interpreted as git options.
    const result = spawnSync('git', ['rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`], { cwd, encoding: 'utf8' });
    if (result.status !== 0) return null;
    if (revision === base) base = result.stdout.trim();
    else head = result.stdout.trim();
  }
  const result = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', base, head, '--'], { cwd, encoding: 'utf8' });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter(Boolean);
}
