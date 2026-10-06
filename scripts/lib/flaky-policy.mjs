import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

// One implementation of what every lane does with a retry-only pass, so the
// unit, integration, infrastructure and browser lanes cannot drift apart.
//
// Publication: the flaky document is always written beside the lane's other
// evidence, but only a run that actually retried something fills the upload
// directory. An empty artifact from every shard of every run would spend the
// weekly report's whole GitHub API budget reading nothing.
//
// Policy: --retry=1 stays, and a retry-only pass is never silently green. On a
// pull request it is a `::warning::` naming the test; on push to main, a
// schedule, a release or a manual dispatch it fails the lane's execution
// verification, matching the browser lane and PRD.md:99.
// See ee/docs/plans/2026-09-05-production-regression-prevention/flaky-retry-policy.md.

// Called before the runner starts: a crashed attempt must not leave the
// previous attempt's flakes behind for the upload step to find.
export function resetFlakyPublication(directory) {
  rmSync(directory, { recursive: true, force: true });
}

// Returns the recorded tests. Reporting a flake never fails the lane, so an
// absent or unparseable document simply reports nothing.
export function publishFlakyTests({ documentPath, directory }) {
  let tests = [];
  try {
    const document = JSON.parse(readFileSync(documentPath, 'utf8'));
    if (Array.isArray(document?.tests)) tests = document.tests;
    if (tests.length) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(path.join(directory, 'flaky-tests.json'), JSON.stringify(document, null, 2) + '\n');
    }
  } catch { return tests; }
  return tests;
}

export function flakyPolicy({ tests, eventName } = {}) {
  const identities = (Array.isArray(tests) ? tests : [])
    .map(entry => (typeof entry === 'string' ? entry : entry?.testId))
    .filter(testId => typeof testId === 'string' && testId.length > 0);
  if (!identities.length) return { warnings: [], failures: [] };
  if (eventName === 'pull_request') {
    return { warnings: identities.map(testId => `::warning::Flaky test passed only on retry: ${testId}`), failures: [] };
  }
  const event = typeof eventName === 'string' && eventName ? eventName : 'unknown';
  return { warnings: [], failures: identities.map(testId => `retry-only pass on ${event} run: ${testId}`) };
}

// Publishes, then reports. `failures` belong in the lane's evidence; the
// warnings are only annotations.
export function applyFlakyPolicy({ documentPath, directory, eventName, log = console.warn }) {
  const tests = publishFlakyTests({ documentPath, directory });
  const policy = flakyPolicy({ tests, eventName });
  for (const warning of policy.warnings) log(warning);
  return { ...policy, tests };
}
