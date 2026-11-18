import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { journeyWeight, parseShard, partitionJourneys, readJourneyWeights, shardFiles } from '../lib/browser-journey-shards.mjs';
import { mergeBrowserShardEvidence } from '../lib/browser-shard-evidence.mjs';
import { readBrowserShardArtifacts, writeMergedBrowserEvidence } from '../merge-browser-shards.mjs';
import { browserArtifact } from '../lib/browser-artifact-files.mjs';
import { readCandidateExecutionBundle } from '../lib/candidate-execution-artifacts.mjs';
import { evaluateCandidateExecution } from '../lib/candidate-execution-gate.mjs';
import { journeyWeightsFromReport, mergeJourneyWeights } from '../update-browser-journey-weights.mjs';
import { recordDockerArchiveBuild } from '../record-docker-archive-build.mjs';
import { browserArtifactServices, createBrowserArchiveReceipt, buildBrowserArtifactManifest } from '../lib/browser-artifact-manifest.mjs';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const revision = 'a'.repeat(40), runId = '123', runAttempt = 2, edition = 'enterprise', root = '/repo';

// A verifiable candidate manifest, the way the fresh-install gate test builds
// one: build records and receipts from the given attempt.
async function buildManifest(attempt) {
  const context = { revision, edition, runId, runAttempt: attempt }, components = [];
  const archiveDir = mkdtempSync(path.join(tmpdir(), 'browser-shard-archives-'));
  try {
    for (const service of browserArtifactServices(edition)) {
      const archive = path.join(archiveDir, `${service}.tar.gz`);
      writeFileSync(archive, gzipSync(Buffer.alloc(1024)));
      const id = `sha256:${'1'.repeat(64)}`, digest = `sha256:${'2'.repeat(64)}`;
      const record = await recordDockerArchiveBuild({ ...context, attempt, service, image: 'candidate:latest',
        dockerfile: 'Dockerfile.build', platform: 'linux/amd64', configImageId: id, buildReportedDigest: digest,
        metadata: { 'containerimage.config.digest': id, 'containerimage.digest': digest } }, archive, path.join(archiveDir, `${service}.json`));
      const receipt = await createBrowserArchiveReceipt(record, archive, context);
      components.push({ record, receipt, inspection: [{ Id: id, Os: 'linux', Architecture: 'amd64', Config: { Labels: { 'org.opencontainers.image.revision': revision } } }] });
    }
    return buildBrowserArtifactManifest({ ...context, components });
  } finally { rmSync(archiveDir, { recursive: true, force: true }); }
}
const manifest = await buildManifest(runAttempt);

const files = ['login', 'invoice', 'portal', 'calendar'].map(name => `e2e-tests/tests/${name}.spec.ts`);
const spec = (file, results = [{ retry: 0, status: 'passed', duration: 1000 }], status = 'expected') => ({
  file: path.basename(file), title: `${path.basename(file, '.spec.ts')} works`,
  tests: [{ projectId: 'ee', projectName: 'enterprise', expectedStatus: 'passed', status, results }] });
const metadata = { edition, authentication: 'real-credentials', serverLifecycle: 'externally-started-production-build' };
const reportOf = (specs, { listed = false } = {}) => ({
  config: { rootDir: `${root}/e2e-tests/tests`, metadata, shard: null }, errors: [],
  suites: specs.map(entry => ({ title: entry.file, file: entry.file, specs: [entry] })),
  stats: { startTime: '2026-10-29T06:00:00.000Z', duration: 1000 * specs.length,
    expected: listed ? 0 : specs.filter(entry => entry.tests[0].status === 'expected').length,
    skipped: listed ? specs.length : 0, unexpected: 0,
    flaky: listed ? 0 : specs.filter(entry => entry.tests[0].status === 'flaky').length } });
const collected = reportOf(files.map(file => spec(file)), { listed: true });
const source = { before: { revision, dirty: false, changes: [] }, after: { revision, dirty: false, changes: [] } };

// What e2e-tests/run.mjs publishes for shard `index` of `total`.
function shard(index, total, { lane = `browser-${index}`, mutate = () => {} } = {}) {
  const assigned = partitionJourneys({ files, total })[index - 1];
  const report = reportOf(assigned.map(file => spec(file)));
  const evidence = { schemaVersion: 1, suite: 'production-browser', revision, status: 'passed', failures: [],
    selection: { mode: 'shard', shard: { index, total }, files: assigned, filters: [] }, source: structuredClone(source), workingTreeDirty: false, configuration: metadata };
  const result = { lane, descriptor: { edition, lane, index, total }, collected: structuredClone(collected), report, evidence, manifest: structuredClone(manifest) };
  mutate(result);
  return result;
}
const merge = (shards, overrides = {}) => mergeBrowserShardEvidence({ edition, shards, root, revision, runId, runAttempt, env: { GITHUB_EVENT_NAME: 'pull_request', GITHUB_HEAD_REF: 'feature' }, ...overrides });

test('shards are parsed strictly and the partition is deterministic, complete and duration-balanced', () => {
  assert.deepEqual(parseShard('2/3'), { index: 2, total: 3 });
  assert.equal(parseShard(undefined), null);
  assert.equal(parseShard(''), null);
  for (const value of ['0/3', '4/3', '1/0', 'a/3', '1-3', '1/3/5']) assert.throws(() => parseShard(value), new RegExp('Invalid browser shard'));
  const weights = { 'e2e-tests/tests/calendar.spec.ts': 116, 'e2e-tests/tests/invoice.spec.ts': 103, 'e2e-tests/tests/portal.spec.ts': 47, 'e2e-tests/tests/login.spec.ts': 12 };
  const partition = partitionJourneys({ files, weights, total: 2 });
  assert.deepEqual(partition, [['e2e-tests/tests/calendar.spec.ts', 'e2e-tests/tests/login.spec.ts'], ['e2e-tests/tests/invoice.spec.ts', 'e2e-tests/tests/portal.spec.ts']]);
  assert.deepEqual(partitionJourneys({ files: [...files].reverse(), weights, total: 2 }), partition, 'input order does not matter');
  assert.deepEqual(partition.flat().sort(), [...files].sort(), 'every file lands exactly once');
  assert.deepEqual(shardFiles({ files, weights, shard: parseShard('2/2') }), partition[1]);
  // An unmeasured journey weighs a typical one, so it cannot stack for free.
  assert.equal(journeyWeight('e2e-tests/tests/new.spec.ts', weights), 103);
  assert.equal(journeyWeight('e2e-tests/tests/new.spec.ts', {}), 30);
  assert.equal(partitionJourneys({ files, total: 1 }).length, 1);
  assert.deepEqual(partitionJourneys({ files: files.slice(0, 2), total: 3 })[2], [], 'more shards than files leaves a shard empty');
  assert.throws(() => partitionJourneys({ files: [...files, files[0]], total: 2 }));
  assert.throws(() => readJourneyWeights({ schemaVersion: 2 }, edition));
  const profile = JSON.parse(readFileSync(path.join(repository, 'e2e-tests/journey-weights.json'), 'utf8'));
  const enterprise = readJourneyWeights(profile, 'enterprise');
  assert.ok(Object.keys(enterprise).length >= 20 && Object.keys(enterprise).every(file => file.startsWith('e2e-tests/tests/')));
  // The committed profile keeps the real enterprise journeys within 10% of
  // each other across three shards; a profile that cannot do that is stale.
  const loads = partitionJourneys({ files: Object.keys(enterprise), weights: enterprise, total: 3 })
    .map(group => group.reduce((sum, file) => sum + enterprise[file], 0));
  assert.ok(Math.max(...loads) - Math.min(...loads) <= Math.max(...loads) * 0.1, `unbalanced shards: ${loads.join(', ')}`);
});

test('complete shards merge into one passing per-edition record the gate accepts', t => {
  const merged = merge([shard(2, 2), shard(1, 2)]);
  assert.equal(merged.complete, true);
  assert.equal(merged.evidence.status, 'passed', merged.evidence.failures.join('\n'));
  assert.deepEqual(merged.evidence.selection.mode, 'full');
  assert.deepEqual(merged.evidence.selection.filters, []);
  assert.deepEqual(merged.evidence.selection.shards.map(entry => [entry.lane, entry.index, entry.total, entry.status]),
    [['browser-1', 1, 2, 'passed'], ['browser-2', 2, 2, 'passed']]);
  assert.equal(merged.report.stats.expected, files.length);
  assert.equal(merged.report.config.shard, null);
  assert.equal(merged.metrics.status, 'passed', merged.metrics.failures.join('\n'));
  assert.equal(merged.metrics.collected, files.length);
  assert.equal(merged.metrics.executed, files.length);
  assert.equal(merged.metrics.artifactManifest.edition, edition);
  assert.deepEqual(merged.flakyDocument.tests, []);
  assert.equal(merged.flakyDocument.job, 'production-browser (enterprise)');
  assert.equal(merged.flakyDocument.eventName, 'pull_request');
  // The written layout is the one the fresh-install gate reads.
  const output = mkdtempSync(path.join(tmpdir(), 'browser-shard-merged-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  writeMergedBrowserEvidence(output, merged);
  const directory = path.dirname(browserArtifact(output, 'evidence.json'));
  assert.equal(directory, path.join(output, 'e2e-tests', 'execution-evidence'));
  assert.equal(browserArtifact(output, 'browser-artifact-manifest.json'), path.join(output, '_temp', 'browser-artifact-manifest.json'));
  const bundle = readCandidateExecutionBundle({ id: 'playwright-enterprise', format: 'playwright', directory, sourceRoot: root, outcome: 'success' });
  const gate = evaluateCandidateExecution({ root, revision, requirements: [{ id: 'playwright-enterprise', format: 'playwright', candidates: files }], bundles: [bundle] });
  assert.equal(gate.status, 'passed', gate.failures.join('\n'));
  assert.ok(!readFileSync(path.join(directory, 'flaky-tests.json'), 'utf8').includes('"tests": [\n    {'), 'no flake, no upload copy');
});

test('a shard that is missing, duplicated, partial or mislabeled fails the merged record', () => {
  const missing = merge([shard(1, 3), shard(3, 3)]);
  assert.equal(missing.complete, false);
  assert.equal(missing.evidence.status, 'failed');
  assert.ok(missing.evidence.failures.includes('Browser shard 2/3 published no evidence'));
  assert.ok(missing.evidence.failures.some(failure => failure.startsWith('Collected/executed browser count differs')), 'the missing journeys are named by the reconcile');
  assert.equal(missing.metrics.status, 'incomplete', 'missing journeys are incomplete, never failed-but-counted');

  const duplicated = merge([shard(1, 2), shard(1, 2, { lane: 'browser-2', mutate: result => { result.descriptor.lane = 'browser-2'; } }), shard(2, 2)]);
  assert.equal(duplicated.complete, false);
  assert.ok(duplicated.evidence.failures.includes('Browser shard 1/2 was published 2 times'));
  assert.ok(duplicated.evidence.failures.some(failure => failure.startsWith('Collected/executed browser count differs')));

  const disagreeing = merge([shard(1, 2), shard(2, 3)]);
  assert.ok(disagreeing.evidence.failures.includes('Browser shards disagree on their total'));
  assert.equal(disagreeing.complete, false);

  const mislabeled = merge([shard(1, 2, { mutate: result => { result.evidence.selection.shard = { index: 2, total: 2 }; } }), shard(2, 2)]);
  assert.ok(mislabeled.evidence.failures.includes('shard browser-1: evidence does not describe shard 1/2'));

  const whole = merge([shard(1, 2, { mutate: result => { result.evidence.selection = { mode: 'full', filters: [] }; } }), shard(2, 2)]);
  assert.equal(whole.evidence.status, 'failed', 'a full run cannot pose as a shard');

  const noDescriptor = merge([shard(1, 2, { mutate: result => { result.descriptor = null; } }), shard(2, 2)]);
  assert.equal(noDescriptor.complete, false);
  assert.ok(noDescriptor.evidence.failures.includes('shard browser-1: missing or invalid shard descriptor'));

  const silent = merge([shard(1, 2, { mutate: result => { result.evidence = null; result.report = null; result.collected = null; } }), shard(2, 2)]);
  assert.equal(silent.complete, true, 'the descriptor says the shard came up');
  assert.equal(silent.evidence.status, 'failed');
  assert.ok(silent.evidence.failures.includes('shard browser-1: no execution evidence'));
  assert.ok(silent.evidence.failures.includes('shard browser-1: no Playwright report'));

  assert.equal(merge([]).evidence.status, 'failed');
  assert.equal(merge([]).complete, false);
  assert.equal(merge([]).metrics.status, 'incomplete');
});

test('a shard rerun on a later attempt still merges with the shards of the earlier attempt', async () => {
  // "Re-run failed jobs" republishes only the failed shard: the build records
  // stay on the attempt that built the images, the rerun shard's manifest and
  // receipts carry the new attempt, and the other shards keep the old one.
  const earlier = await buildManifest(1);
  const later = structuredClone(earlier);
  later.runAttempt = 2;
  for (const component of later.components) component.receipt.runAttempt = 2;
  const merged = merge([shard(1, 2, { mutate: result => { result.manifest = earlier; } }), shard(2, 2, { mutate: result => { result.manifest = later; } })]);
  assert.equal(merged.evidence.status, 'passed', merged.evidence.failures.join('\n'));
  assert.equal(merged.metrics.status, 'passed', merged.metrics.failures.join('\n'));
  assert.ok(merged.manifest, 'one candidate manifest is kept');
});

test('shards must agree on the collection, the candidate and the checkout, and carry their own failures', () => {
  const differentCollection = merge([shard(1, 2, { mutate: result => { result.collected.suites.pop(); } }), shard(2, 2)]);
  assert.ok(differentCollection.evidence.failures.includes('shard browser-2: collected different journeys'));

  // A different image behind the same service: the candidate itself differs,
  // not merely the attempt that verified it.
  const differentCandidate = merge([shard(1, 2), shard(2, 2, { mutate: result => { result.manifest.components[0].record.configImageId = `sha256:${'f'.repeat(64)}`; } })]);
  assert.ok(differentCandidate.evidence.failures.includes('shard browser-2: verified a different candidate'));
  assert.equal(differentCandidate.manifest, null);
  assert.equal(differentCandidate.metrics.status, 'incomplete');

  const differentRevision = merge([shard(1, 2), shard(2, 2, { mutate: result => { result.evidence.revision = 'b'.repeat(40); } })]);
  assert.ok(differentRevision.evidence.failures.includes('shard browser-2: tested a different revision'));

  const dirty = merge([shard(1, 2), shard(2, 2, { mutate: result => { result.evidence.workingTreeDirty = true; result.evidence.source.after.dirty = true; } })]);
  assert.ok(dirty.evidence.failures.includes('Browser shards ran from different checkouts'));
  assert.equal(dirty.evidence.workingTreeDirty, true);
  assert.equal(dirty.metrics.status, 'failed');

  const failedShard = merge([shard(1, 2, { mutate: result => {
    result.evidence.status = 'failed'; result.evidence.failures = ['Browser runner exited with 1'];
    result.report.suites[0].specs[0].tests[0].status = 'unexpected';
    result.report.suites[0].specs[0].tests[0].results = [{ retry: 0, status: 'failed', duration: 5 }];
    result.report.stats.expected--; result.report.stats.unexpected++;
  } }), shard(2, 2)]);
  assert.ok(failedShard.evidence.failures.includes('shard browser-1: Browser runner exited with 1'));
  assert.equal(failedShard.evidence.counts.failed, 1);
  assert.equal(failedShard.evidence.selection.shards[0].status, 'failed');

  const flaky = merge([shard(1, 2), shard(2, 2, { mutate: result => {
    const entry = result.report.suites[0].specs[0].tests[0];
    entry.status = 'flaky'; entry.results = [{ retry: 0, status: 'failed', duration: 5 }, { retry: 1, status: 'passed', duration: 5 }];
    result.report.stats.expected--; result.report.stats.flaky++;
    result.evidence.status = 'failed'; result.evidence.failures = ['Browser report contains failed, flaky or skipped cases'];
  } })]);
  assert.equal(flaky.evidence.status, 'failed');
  assert.equal(flaky.flakyDocument.tests.length, 1);
  assert.equal(flaky.flakyDocument.tests[0].retryCount, 1);

  // GITHUB_SHA imposes the revision; shards must have tested it.
  const imposed = merge([shard(1, 2), shard(2, 2)], { revision: 'c'.repeat(40) });
  assert.ok(imposed.evidence.failures.includes('shard browser-1: tested a different revision'));
  const inferred = merge([shard(1, 2), shard(2, 2)], { revision: undefined });
  assert.equal(inferred.evidence.revision, revision);
  assert.equal(inferred.evidence.status, 'passed', inferred.evidence.failures.join('\n'));
});

test('the merge command reads downloaded shard artifact trees and reports completeness to the workflow', t => {
  const input = mkdtempSync(path.join(tmpdir(), 'browser-shard-input-'));
  const output = path.join(input, 'merged');
  const outputs = path.join(input, 'github-output');
  t.after(() => rmSync(input, { recursive: true, force: true }));
  const place = (result, { withDescriptor = true } = {}) => {
    const directory = path.join(input, `fresh-install-browser-shard-${edition}-${result.lane}`);
    const evidence = path.join(directory, 'alga-psa', 'alga-psa', 'e2e-tests', 'execution-evidence');
    mkdirSync(evidence, { recursive: true });
    mkdirSync(path.join(directory, '_temp'), { recursive: true });
    // Harness results reuse the evidence filenames; they must not be mistaken
    // for the shard's evidence.
    mkdirSync(path.join(directory, 'alga-psa', 'alga-psa', 'e2e-tests', 'harness-results', 'flaky'), { recursive: true });
    writeFileSync(path.join(directory, 'alga-psa', 'alga-psa', 'e2e-tests', 'harness-results', 'flaky', 'evidence.json'), '{"status":"failed"}');
    for (const [name, value] of [['collected', result.collected], ['results', result.report], ['evidence', result.evidence]]) {
      writeFileSync(path.join(evidence, `${name}.json`), JSON.stringify(value));
    }
    writeFileSync(path.join(directory, '_temp', 'browser-artifact-manifest.json'), JSON.stringify(result.manifest));
    if (withDescriptor) writeFileSync(path.join(directory, '_temp', 'browser-shard.json'), JSON.stringify(result.descriptor));
  };
  place(shard(1, 2)); place(shard(2, 2));
  mkdirSync(path.join(input, 'fresh-install-browser-shard-community-browser-1'), { recursive: true });
  mkdirSync(path.join(input, 'fresh-install-api-enterprise'), { recursive: true });
  const read = readBrowserShardArtifacts(input, edition);
  assert.deepEqual(read.map(entry => entry.lane).sort(), ['browser-1', 'browser-2']);
  assert.equal(read[0].evidence.selection.mode, 'shard');
  assert.deepEqual(readBrowserShardArtifacts(path.join(input, 'absent'), edition), []);
  const run = () => spawnSync(process.execPath, [path.join(repository, 'scripts/merge-browser-shards.mjs'),
    '--edition', edition, '--input', input, '--output', output], { encoding: 'utf8',
    env: { ...process.env, GITHUB_SHA: revision, GITHUB_RUN_ID: runId, GITHUB_RUN_ATTEMPT: String(runAttempt), GITHUB_OUTPUT: outputs, GITHUB_STEP_SUMMARY: '' } });
  // The merged journeys must resolve under this checkout's root, as the real
  // gate does with the runner's checkout, so the fixture root is this repository.
  for (const entry of read) {
    for (const value of [entry.collected, entry.report]) value.config.rootDir = path.join(repository, 'e2e-tests', 'tests');
    place(entry);
  }
  let result = run();
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /Browser shard evidence \(enterprise\): passed; 2 of 2 shards published; journeys 4\/4/);
  assert.match(readFileSync(outputs, 'utf8'), /^complete=true\nstatus=passed\n$/m);
  const written = JSON.parse(readFileSync(path.join(output, 'e2e-tests', 'execution-evidence', 'evidence.json'), 'utf8'));
  assert.equal(written.status, 'passed', written.failures.join('\n'));
  assert.ok(readFileSync(path.join(output, '_temp', 'browser-artifact-manifest.json'), 'utf8').includes(revision));

  rmSync(path.join(input, `fresh-install-browser-shard-${edition}-browser-2`), { recursive: true, force: true });
  writeFileSync(outputs, '');
  result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Browser shard 2\/2 published no evidence/);
  assert.match(readFileSync(outputs, 'utf8'), /^complete=false\nstatus=failed\n$/m);
  assert.equal(JSON.parse(readFileSync(path.join(output, 'e2e-tests', 'execution-evidence', 'metrics.json'), 'utf8')).status, 'incomplete');
});

test('the weight profile is refreshed from a report, one edition at a time, keeping unmeasured files', () => {
  const report = reportOf([spec(files[0], [{ retry: 0, status: 'failed', duration: 4000 }, { retry: 1, status: 'passed', duration: 2600 }], 'flaky'), spec(files[1], [{ retry: 0, status: 'passed', duration: 500 }])]);
  report.config.rootDir = `${root}/e2e-tests/tests`;
  const update = journeyWeightsFromReport(report, root);
  assert.deepEqual(update, { edition, weights: { 'e2e-tests/tests/invoice.spec.ts': 1, 'e2e-tests/tests/login.spec.ts': 7 } });
  const profile = { schemaVersion: 1, unit: 'seconds', editions: { community: { 'e2e-tests/tests/login.spec.ts': 3 },
    enterprise: { 'e2e-tests/tests/login.spec.ts': 12, 'e2e-tests/tests/portal.spec.ts': 47 } } };
  const merged = mergeJourneyWeights(profile, update, { source: 'run 1' });
  assert.deepEqual(merged.editions.enterprise, { 'e2e-tests/tests/invoice.spec.ts': 1, 'e2e-tests/tests/login.spec.ts': 7, 'e2e-tests/tests/portal.spec.ts': 47 });
  assert.deepEqual(merged.editions.community, profile.editions.community);
  assert.equal(merged.source, 'run 1');
  assert.throws(() => journeyWeightsFromReport({ ...report, config: { ...report.config, metadata: {} } }, root));
});
