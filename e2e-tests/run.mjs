import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publishFlakyTests, resetFlakyPublication } from '../scripts/lib/flaky-policy.mjs';
import { reconcileDiscovery, repositoryTestFiles } from '../scripts/lib/test-discovery.mjs';
import { flakyPlaywrightTests, playwrightTests, reconcilePlaywrightExecution } from '../scripts/lib/playwright-execution-evidence.mjs';
import { testRevision } from '../scripts/lib/test-revision.mjs';
import { browserTestMetrics } from '../scripts/lib/browser-test-metrics.mjs';
import { parseShard, readJourneyWeights, shardFiles } from '../scripts/lib/browser-journey-shards.mjs';

const require = createRequire(import.meta.url);
const cwd = fileURLToPath(new URL('.', import.meta.url));
const root = path.resolve(cwd, '..');
const output = path.join(cwd, 'execution-evidence');
mkdirSync(output, { recursive: true });
const files = Object.fromEntries(['collected', 'collected-shard', 'results', 'discovery', 'evidence', 'metrics', 'flaky-tests'].map(name => [name, path.join(output, `${name}.json`)]));
for (const file of Object.values(files)) writeFileSync(file, 'null\n');
// A rerun in the same workspace must not resurrect the previous run's flakes.
const flakyUpload = path.join(output, 'flaky');
resetFlakyPublication(flakyUpload);
const save = (file, data) => writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
let before;
let evidence;
// E2E_SHARD=<index>/<total> runs this runner's share of the journeys. The
// partition is computed here from the full collection and the committed weight
// profile, so every shard of a run derives the same split; CI merges the shards'
// evidence back into one per-edition record and reconciles it against the full
// collection, which is what makes a partition safe where a filter is not.
let shard = null;
let assigned = null;
try {
  if (process.argv.length > 2) throw new Error('The production gate runs its entire test directory. Use Playwright directly for a filtered investigation.');
  shard = parseShard(process.env.E2E_SHARD);
  before = testRevision(root);
  const cli = require.resolve('@playwright/test/cli');
  const run = (args, report) => spawnSync(process.execPath, [cli, 'test', '--config', path.join(cwd, 'playwright.config.ts'), ...args], {
    cwd, stdio: 'inherit',
    env: { ...process.env, E2E_REVISION: before.revision, PLAYWRIGHT_JSON_OUTPUT_FILE: report },
  });
  const collection = run(['--list', '--reporter=json'], files.collected);
  if (collection.status !== 0) throw new Error(`Browser collection failed (exit ${collection.status})`);
  const collected = JSON.parse(readFileSync(files.collected, 'utf8'));
  const cases = playwrightTests(collected, root);
  const discovered = [...new Set(cases.map(entry => entry.file))];
  const discovery = reconcileDiscovery({ root,
    candidates: repositoryTestFiles(root).filter(file => file.startsWith('e2e-tests/tests/')),
    collections: [{ runner: 'production-browser', status: 'passed', files: discovered }],
  });
  save(files.discovery, discovery);
  if (discovery.status !== 'passed') throw new Error(discovery.failures.join('\n'));
  let expected = collected;
  let selection = [];
  if (shard) {
    const profile = JSON.parse(readFileSync(path.join(cwd, 'journey-weights.json'), 'utf8'));
    assigned = shardFiles({ files: [...discovered].sort(), weights: readJourneyWeights(profile, collected.config.metadata.edition), shard });
    if (!assigned.length) throw new Error(`Browser shard ${shard.index}/${shard.total} has no journeys to run`);
    // Playwright treats file arguments as path filters; list what they select
    // and refuse to run unless it is exactly this shard's assignment.
    selection = assigned.map(file => path.relative(cwd, path.join(root, file)));
    const shardCollection = run(['--list', '--reporter=json', ...selection], files['collected-shard']);
    if (shardCollection.status !== 0) throw new Error(`Browser shard collection failed (exit ${shardCollection.status})`);
    expected = JSON.parse(readFileSync(files['collected-shard'], 'utf8'));
    const listed = [...new Set(playwrightTests(expected, root).map(entry => entry.file))].sort();
    if (JSON.stringify(listed) !== JSON.stringify(assigned)) throw new Error('Browser shard collection differs from its assigned journeys');
  }
  const result = run(selection, files.results);
  let report;
  try { report = JSON.parse(readFileSync(files.results, 'utf8')); } catch { report = null; }
  evidence = reconcilePlaywrightExecution({ collected: expected, report, root, revision: before.revision, exitCode: result.status });
  evidence.configuration = collected.config.metadata;
  evidence.selection = shard ? { mode: 'shard', shard, files: assigned, filters: [] } : { mode: 'full', filters: [] };
} catch (error) {
  evidence = { schemaVersion: 1, suite: 'production-browser', revision: before?.revision, status: 'failed', failures: [error.message] };
  if (shard) evidence.selection = { mode: 'shard', shard, files: assigned ?? [], filters: [] };
}
try {
  const after = testRevision(root);
  evidence.source = { before, after };
  evidence.workingTreeDirty = Boolean(before?.dirty || after.dirty);
  if (evidence.workingTreeDirty) {
    evidence.status = 'failed';
    evidence.failures.push('Browser gate requires clean source before and after execution');
  }
  if (before?.revision !== after.revision) {
    evidence.status = 'failed';
    evidence.failures.push('Repository revision changed during browser testing');
  }
} catch (error) {
  evidence.status = 'failed';
  evidence.failures.push(error.message);
}
save(files.evidence, evidence);
const readReport = file => {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; }
};
// A shard's metrics describe the shard; the merged per-edition metrics that
// reach the readiness tab are recomputed by CI from every shard's raw report.
save(files.metrics, browserTestMetrics({ collected: readReport(shard ? files['collected-shard'] : files.collected), report: readReport(files.results),
  evidence, root, revision: before?.revision,
  artifactManifest: process.env.E2E_ARTIFACT_MANIFEST ? readReport(process.env.E2E_ARTIFACT_MANIFEST) : null,
  artifactManifestRequired: Boolean(process.env.E2E_ARTIFACT_MANIFEST),
  runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) }));
// Always written next to the rest of the evidence, so a green run still shows
// the reporter ran. Only a run that actually retried gets the upload copy the
// weekly report downloads: an empty artifact from every run would spend that
// job's whole GitHub API budget reading nothing.
let flaky = [];
try { flaky = flakyPlaywrightTests(readReport(files.results), root); } catch { flaky = []; }
const edition = readReport(files.collected)?.config?.metadata?.edition ?? null;
const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
const flakyDocument = {
  schemaVersion: 1, suite: 'production-browser',
  job: `production-browser (${edition ?? 'unknown'})${shard ? ` shard ${shard.index}/${shard.total}` : ''}`,
  ...(shard ? { shard } : {}),
  edition, revision: before?.revision ?? null, runId: process.env.GITHUB_RUN_ID ?? null,
  runAttempt: Number.isSafeInteger(runAttempt) && runAttempt > 0 ? runAttempt : null,
  // Which revision a flake was observed on decides whether it is somebody's
  // branch misbehaving or main; the weekly report counts the two apart.
  eventName: process.env.GITHUB_EVENT_NAME || null,
  branch: process.env.GITHUB_HEAD_REF || process.env.GITHUB_REF_NAME || null,
  tests: flaky.map(({ testId, file, name, projectName, retryCount }) => ({ testId, file, name, project: projectName, retryCount })),
};
save(files['flaky-tests'], flakyDocument);
publishFlakyTests({ documentPath: files['flaky-tests'], directory: flakyUpload });
for (const failure of evidence.failures) console.error(failure);
process.exit(evidence.status === 'passed' ? 0 : 1);
