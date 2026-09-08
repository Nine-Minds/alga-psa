import test from 'node:test';
import assert from 'node:assert/strict';
import { teamsDevelopmentFiles, verifyTeamsDevelopment } from '../lib/teams-development-evidence.mjs';
const revision = 'a'.repeat(40), root = '/repository';
function fixture() {
  const report = { stats: { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, errors: [],
    config: { rootDir: root, metadata: { sourceRevision: revision, releaseValidation: false, requiredServerNodeEnv: 'development', integrationSurface: 'teams' } },
    suites: [{ specs: [{ file: teamsDevelopmentFiles[0], title: 'setup recovery', tests: [{ projectId: 'enterprise-chromium', projectName: 'enterprise-chromium',
      expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }] }] }] };
  return { root, revision, collected: structuredClone(report), report, exitCode: 0 };
}
test('complete Teams run is explicitly development evidence', () => {
  const result = verifyTeamsDevelopment(fixture());
  assert.equal(result.status, 'passed');
  assert.equal(result.suite, 'teams-development-browser');
  assert.equal(result.releaseValidation, false);
});
for (const [name, mutate] of Object.entries({
  'release claim': x => { x.report.config.metadata.releaseValidation = true; },
  'production configuration': x => { x.collected.config.metadata.requiredServerNodeEnv = 'production'; },
  'wrong source': x => { x.report.config.metadata.sourceRevision = 'b'.repeat(40); },
  'missing journey': x => { x.collected.suites = []; x.report.suites = []; },
  'missing execution': x => { x.report.suites = []; },
  'retry-only pass': x => { x.report.suites[0].specs[0].tests[0].results[0].retry = 1; },
  'failed runner': x => { x.exitCode = 1; },
})) test(`Teams evidence rejects ${name}`, () => {
  const input = fixture(); mutate(input);
  assert.equal(verifyTeamsDevelopment(input).status, 'failed');
});
