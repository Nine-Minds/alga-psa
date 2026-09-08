import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedUpgradeBaseline, upgradeBrowserFiles, verifySupportedUpgrade } from '../lib/supported-upgrade-evidence.mjs';
const revision = 'a'.repeat(40), root = '/repository';
function input() {
  const report = { stats: { expected: 3, unexpected: 0, skipped: 0, flaky: 0 }, config: { rootDir: root, metadata: { sourceRevision: revision } }, errors: [],
    suites: upgradeBrowserFiles.map(file => ({ specs: [{ file, title: file,
      tests: [{ projectId: 'ee', projectName: 'ee', expectedStatus: 'passed', status: 'expected', results: [{ status: 'passed', retry: 0, errors: [] }] }] }] })) };
  return { revision, root, database: 'upgrade_ci', applicationRevision: revision, exitCode: 0,
    schema: { schemaVersion: 1, status: 'passed', phase: 'schema-and-retention', database: 'upgrade_ci', baseline: { commit: supportedUpgradeBaseline },
      source: { revision, dirty: false }, sourceAfter: { revision, dirty: false }, migrations: { baseline: 1028, upgrade: ['new.cjs'], batch: 2 } },
    collected: structuredClone(report), report };
}
test('complete exact-source upgrade and raw browser results pass', () => assert.equal(verifySupportedUpgrade(input()).status, 'passed'));
for (const [name, mutate] of Object.entries({
  'missing journey': x => { x.collected.suites.pop(); x.report.suites.pop(); },
  'wrong baseline': x => { x.schema.baseline.commit = revision; },
  'old app': x => { x.applicationRevision = 'b'.repeat(40); },
  'dirty source': x => { x.schema.source.dirty = true; },
  'wrong database': x => { x.database = 'upgrade_other'; },
  'failed migration': x => { x.schema.status = 'failed'; },
  'missing schema': x => { x.schema = undefined; },
  'stale browser': x => { x.report.config.metadata.sourceRevision = 'b'.repeat(40); },
  'retry only pass': x => { x.report.suites[0].specs[0].tests[0].results[0].retry = 1; },
  'skipped case': x => { x.report.suites[0].specs[0].tests[0].status = 'skipped'; },
  'missing execution': x => { x.report.suites.pop(); },
})) test(`upgrade rejects ${name}`, () => { const x = input(); mutate(x); assert.equal(verifySupportedUpgrade(x).status, 'failed'); });
