import { playwrightTests, reconcilePlaywrightExecution } from './playwright-execution-evidence.mjs';
import { verifyUpgradeDistribution } from './upgrade-citus.mjs';

export const upgradeBrowserFiles = ['retained-invoice', 'retained-ticket', 'retained-usage']
  .map(name => `e2e-tests/upgrade-tests/${name}.spec.ts`);
export const supportedUpgradeBaseline = 'f3579f3a317cf51df5f4489e5dcd8f649bb71289';

export function verifySupportedUpgrade({ revision, schema, collected, report, exitCode, root, database, applicationRevision, expectedBackend = 'postgres' }) {
  const failures = [];
  const backend = schema?.backend ?? 'postgres';
  if (!['postgres', 'citus'].includes(expectedBackend) || backend !== expectedBackend) failures.push('Upgrade database backend differs from required backend');
  if (expectedBackend === 'citus') {
    for (const stage of ['baseline', 'upgraded']) {
      try { verifyUpgradeDistribution(schema?.distribution?.[stage]); }
      catch (error) { failures.push(`Invalid Citus ${stage} distribution: ${error.message}`); }
    }
  }
  if (!/^[a-f0-9]{40}$/.test(revision || '')) failures.push('Invalid candidate revision');
  if (schema?.schemaVersion !== 1 || schema.status !== 'passed' || schema.phase !== 'schema-and-retention') failures.push('Missing successful schema/retention execution');
  if (schema?.baseline?.commit !== supportedUpgradeBaseline) failures.push('Wrong supported baseline');
  for (const field of ['source', 'sourceAfter']) {
    if (schema?.[field]?.revision !== revision || schema?.[field]?.dirty !== false) failures.push(`Stale or dirty upgrade ${field}`);
  }
  if (!/^upgrade_[a-z0-9_]{1,50}$/.test(database || '') || schema?.database !== database) failures.push('Browser and upgraded database identities differ');
  if (applicationRevision !== revision) failures.push('Application build differs from candidate');
  if (!Number.isInteger(schema?.migrations?.baseline) || schema.migrations.baseline < 1
    || !Array.isArray(schema?.migrations?.upgrade) || !Number.isInteger(schema?.migrations?.batch)) failures.push('Missing migration execution details');
  try {
    const files = new Set(playwrightTests(collected, root).map(test => test.file));
    if (files.size !== upgradeBrowserFiles.length || upgradeBrowserFiles.some(file => !files.has(file))) failures.push('Missing or unexpected required upgrade journey');
  } catch (error) { failures.push(error.message); }
  for (const [label, value] of [['collection', collected], ['execution', report]]) {
    if (value?.config?.metadata?.sourceRevision !== revision) failures.push(`Wrong ${label} revision`);
  }
  const browser = reconcilePlaywrightExecution({ collected, report, root, revision, exitCode });
  failures.push(...browser.failures);
  return { schemaVersion: 1, scope: 'supported-upgrade', revision, status: failures.length ? 'failed' : 'passed',
    failures, database, backend, baselineRevision: supportedUpgradeBaseline, results: [
      { id: 'upgrade-schema', counts: { passed: 1, failed: 0 }, status: failures.some(f => !browser.failures.includes(f)) ? 'failed' : 'passed', failures: failures.filter(f => !browser.failures.includes(f)) },
      { ...browser, id: 'upgrade-browser' },
    ] };
}
