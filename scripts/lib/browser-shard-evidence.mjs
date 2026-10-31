import { flakyPlaywrightTests, reconcilePlaywrightExecution } from './playwright-execution-evidence.mjs';
import { browserTestMetrics } from './browser-test-metrics.mjs';
import { validateBrowserArtifactManifest } from './browser-artifact-manifest.mjs';

// One edition's browser journeys run as several Playwright shards, each
// publishing its own collection, report, evidence and candidate manifest. This
// folds them back into the single per-edition record that the fresh-install
// gate, the readiness recorder and the weekly flaky report were written for.
//
// Nothing here trusts a shard's verdict: the merged report is reconciled against
// the full collection again, so a missing shard, an over-matched file filter or
// a journey run twice all surface as missing or unexpected tests. A shard's own
// failures are carried along with its lane so a red merge names its source.
//
// `shards` entries: { lane, descriptor, collected, report, evidence, manifest },
// each file null when the shard did not publish it. `descriptor` is the
// workflow's `_temp/browser-shard.json` ({ edition, lane, index, total }),
// written before the journeys run, so a shard whose installation came up but
// whose runner never started is still counted and still fails the merge.
export function mergeBrowserShardEvidence({ edition, shards, root, revision, runId, runAttempt, env = process.env }) {
  const failures = [];
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!['community', 'enterprise'].includes(edition)) failures.push('Invalid browser edition');
  if (!Array.isArray(shards)) throw new Error('Browser shards must be an array');

  // Shard identity comes from the descriptors, independent of the runner.
  const described = shards.map(shard => {
    const descriptor = shard.descriptor;
    const valid = object(descriptor) && descriptor.edition === edition && descriptor.lane === shard.lane
      && Number.isSafeInteger(descriptor.index) && Number.isSafeInteger(descriptor.total)
      && descriptor.index >= 1 && descriptor.index <= descriptor.total;
    if (!valid) failures.push(`shard ${shard.lane}: missing or invalid shard descriptor`);
    return { ...shard, index: valid ? descriptor.index : Number.POSITIVE_INFINITY, total: valid ? descriptor.total : null };
  }).sort((a, b) => a.index - b.index || String(a.lane).localeCompare(String(b.lane)));
  const totals = new Set(described.map(shard => shard.total).filter(total => total !== null));
  if (totals.size > 1) failures.push('Browser shards disagree on their total');
  const total = totals.size === 1 ? [...totals][0] : null;
  let complete = total !== null && totals.size === 1;
  if (total !== null) {
    for (let index = 1; index <= total; index++) {
      const count = described.filter(shard => shard.index === index).length;
      if (count === 0) { failures.push(`Browser shard ${index}/${total} published no evidence`); complete = false; }
      if (count > 1) { failures.push(`Browser shard ${index}/${total} was published ${count} times`); complete = false; }
    }
  } else if (!described.length) failures.push('No browser shard published evidence');

  // Each shard's own evidence must describe exactly the shard it claims to be.
  const statuses = [];
  for (const shard of described) {
    const evidence = shard.evidence;
    const prefix = `shard ${shard.lane}`;
    if (!object(evidence)) { failures.push(`${prefix}: no execution evidence`); statuses.push('missing'); continue; }
    statuses.push(typeof evidence.status === 'string' ? evidence.status : 'invalid');
    if (evidence.schemaVersion !== 1 || evidence.suite !== 'production-browser') failures.push(`${prefix}: unsupported execution evidence`);
    if (evidence.selection?.mode !== 'shard' || !equal(evidence.selection.shard, { index: shard.index, total: shard.total })) {
      failures.push(`${prefix}: evidence does not describe shard ${shard.index}/${shard.total}`);
    }
    if (Array.isArray(evidence.selection?.filters) && evidence.selection.filters.length) failures.push(`${prefix}: filtered execution`);
    for (const failure of Array.isArray(evidence.failures) ? evidence.failures : []) failures.push(`${prefix}: ${failure}`);
  }

  // The revision is either imposed by the caller (CI's GITHUB_SHA) or must be
  // the one every shard agrees on.
  const revisions = [...new Set(described.map(shard => shard.evidence?.revision).filter(value => typeof value === 'string'))];
  if (revision === undefined) revision = revisions.length === 1 ? revisions[0] : null;
  for (const shard of described) {
    if (object(shard.evidence) && shard.evidence.revision !== revision) failures.push(`shard ${shard.lane}: tested a different revision`);
  }

  // Every shard lists the whole collection; it is the merged expectation.
  const collections = described.filter(shard => object(shard.collected) && Array.isArray(shard.collected.suites));
  const collected = collections[0]?.collected ?? null;
  if (!collected) failures.push('No browser shard published a collection');
  const collectionIdentity = value => ({ rootDir: value.config?.rootDir, metadata: value.config?.metadata, suites: value.suites });
  for (const shard of collections.slice(1)) {
    if (!equal(collectionIdentity(shard.collected), collectionIdentity(collected))) failures.push(`shard ${shard.lane}: collected different journeys`);
  }
  if (collected && collected.config?.metadata?.edition !== edition) failures.push('Browser collection has a missing or different edition');

  // The merged report is the concatenation of the shard reports in shard order.
  const reports = described.filter(shard => object(shard.report) && Array.isArray(shard.report.suites));
  for (const shard of described) if (!reports.includes(shard)) failures.push(`shard ${shard.lane}: no Playwright report`);
  let report = null;
  if (reports.length) {
    const stats = { startTime: null, duration: 0, expected: 0, skipped: 0, unexpected: 0, flaky: 0 };
    let start = Number.POSITIVE_INFINITY, end = Number.NEGATIVE_INFINITY;
    for (const { report: shardReport } of reports) {
      for (const key of ['expected', 'skipped', 'unexpected', 'flaky']) {
        stats[key] = Number.isSafeInteger(shardReport.stats?.[key]) ? stats[key] + shardReport.stats[key] : Number.NaN;
      }
      const began = Date.parse(shardReport.stats?.startTime ?? '');
      if (Number.isFinite(began) && typeof shardReport.stats?.duration === 'number') {
        start = Math.min(start, began); end = Math.max(end, began + shardReport.stats.duration);
      }
    }
    if (Number.isFinite(start)) { stats.startTime = new Date(start).toISOString(); stats.duration = end - start; }
    report = { config: { ...reports[0].report.config, shard: null },
      suites: reports.flatMap(shard => shard.report.suites),
      errors: reports.flatMap(shard => Array.isArray(shard.report.errors) ? shard.report.errors : [{ message: 'Shard report has no error list' }]),
      stats };
  }

  // Every shard pulled the same images by digest, so their manifests must
  // describe one candidate; anything else is a candidate identity problem, not
  // noise. A partial "re-run failed jobs" leaves some shards' artifacts on an
  // earlier attempt, whose manifests and receipts carry that attempt number,
  // so the comparison is on what names the candidate (the verified build
  // records), never on the attempt that verified it.
  const manifests = described.filter(shard => object(shard.manifest));
  const candidateIdentity = value => ({ kind: value.kind, scope: value.scope, revision: value.revision, edition: value.edition,
    runId: value.runId, components: Array.isArray(value.components) ? value.components.map(component => component?.record) : value.components });
  let manifest = manifests[0]?.manifest ?? null;
  if (!manifest) failures.push('No browser shard published a candidate manifest');
  for (const shard of manifests.slice(1)) {
    if (!equal(candidateIdentity(shard.manifest), candidateIdentity(manifest))) { failures.push(`shard ${shard.lane}: verified a different candidate`); manifest = null; }
  }
  if (manifest) {
    try { validateBrowserArtifactManifest(manifest, { revision, edition, runId, runAttempt }); }
    catch { failures.push('Browser shard candidate manifest is invalid for this run'); }
  }

  // Source cleanliness is per shard; the merged record keeps the shared value
  // and refuses to pick one when they differ.
  const sources = described.filter(shard => object(shard.evidence?.source)).map(shard => shard.evidence.source);
  const source = sources[0] ?? null;
  for (const other of sources.slice(1)) if (!equal(other, source)) { failures.push('Browser shards ran from different checkouts'); break; }
  const workingTreeDirty = !described.length || described.some(shard => shard.evidence?.workingTreeDirty !== false);

  const passed = complete && described.length > 0 && statuses.every(status => status === 'passed');
  const evidence = reconcilePlaywrightExecution({ collected, report, root, revision, exitCode: passed ? 0 : 1 });
  evidence.failures.push(...failures);
  if (evidence.failures.length) evidence.status = 'failed';
  evidence.edition = edition;
  evidence.configuration = collected?.config?.metadata ?? null;
  evidence.selection = { mode: 'full', filters: [], shards: described.map((shard, position) => ({
    lane: shard.lane, index: Number.isFinite(shard.index) ? shard.index : null, total: shard.total, status: statuses[position],
    files: Array.isArray(shard.evidence?.selection?.files) ? shard.evidence.selection.files : [] })) };
  evidence.source = source ?? undefined;
  evidence.workingTreeDirty = workingTreeDirty;

  const metrics = browserTestMetrics({ collected, report, evidence, root, revision,
    artifactManifest: manifest, artifactManifestRequired: true, runId, runAttempt });

  // Flakes are read off the merged report, never summed from shard documents.
  let flaky = [];
  try { flaky = flakyPlaywrightTests(report, root); } catch { flaky = []; }
  const attempt = Number(runAttempt);
  const flakyDocument = {
    schemaVersion: 1, suite: 'production-browser', job: `production-browser (${edition})`, edition,
    revision: revision ?? null, runId: runId ?? null, runAttempt: Number.isSafeInteger(attempt) && attempt > 0 ? attempt : null,
    eventName: env.GITHUB_EVENT_NAME || null, branch: env.GITHUB_HEAD_REF || env.GITHUB_REF_NAME || null,
    shards: evidence.selection.shards.map(({ lane, index, total }) => ({ lane, index, total })),
    tests: flaky.map(({ testId, file, name, projectName, retryCount }) => ({ testId, file, name, project: projectName, retryCount })),
  };
  return { complete, collected, report, evidence, metrics, flakyDocument, manifest };
}
