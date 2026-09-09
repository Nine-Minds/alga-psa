import { readFileSync } from 'node:fs';
import path from 'node:path';
import { readRunnerCollection } from './read-runner-collection.mjs';
import { reconcileDiscovery } from './test-discovery.mjs';

// These are artifact identities from the execution lanes, not test-file globs.
// Never recollect the large suites here: their raw registrations are already
// preserved by the jobs that execute them.
export function vitestInventoryArtifacts(revision) {
  return [
    ['server-unit', 'server-unit-execution/test-results/server-coverage', 'CI and domain maintainers', 'Node/jsdom'],
    ...['workspace-unit', 'workspace-runtime', 'server-colocated', 'nx-tooling', 'ui-kit-showcase', 'enterprise-integration', 'ai-gateway']
      .map(suite => [suite, `${suite}-${revision}`, 'Workspace maintainers', 'Existing workspace CI runtime']),
    ...[1, 2, 3].map(n => [`enterprise-unit-${n}`, `enterprise-unit-shard-${n}`, 'Enterprise maintainers', 'Node/jsdom']),
    ...[1, 2, 3, 4].map(n => [`integration-${n}`, `server-integration-shard-${n}`, 'CI and domain maintainers', 'PostgreSQL/Redis']),
    ...[1, 2, 3].map(n => [`infrastructure-${n}`, `infrastructure-shard-${n}`, 'Platform maintainers', 'PostgreSQL/Redis']),
    ['workspace-db', 'workspace-db-evidence', 'Workspace maintainers', 'PostgreSQL/Redis'],
    ['api-e2e', 'fresh-install-api-community', 'API maintainers', 'Built application/PostgreSQL'],
    ...['readiness', 'engine', 'database'].map(lane => [`temporal-${lane}`, `temporal-${lane}-execution`, 'Platform maintainers', 'Temporal/PostgreSQL/Citus']),
    ['mobile', 'mobile-execution', 'Mobile maintainers', 'Mobile Vitest configuration'],
  ].map(([runner, directory, owner, runtime]) => ({ runner, directory, owner, runtime }));
}

export function requireInventorySource(source, revision) {
  for (const phase of ['before', 'after']) {
    const value = source?.[phase];
    if (value?.revision !== revision || value.dirty !== false || !Array.isArray(value.changes) || value.changes.length) {
      throw new Error(`Missing, stale or dirty inventory source: ${phase}`);
    }
  }
}

export function readVitestInventoryArtifact({ input, root, revision, descriptor }) {
  const directory = path.join(input, descriptor.directory);
  const read = file => JSON.parse(readFileSync(path.join(directory, file), 'utf8'));
  const source = descriptor.runner === 'mobile'
    ? { before: read('source-before.json'), after: read('source-after.json') }
    : read('evidence.json').source;
  requireInventorySource(source, revision);
  return readRunnerCollection({ runner: descriptor.runner, owner: descriptor.owner, runtime: descriptor.runtime,
    mandatory: true, status: 'passed', format: 'vitest', sourceRoot: root,
    collectionFile: path.join(directory, 'collected.json'), casesFile: path.join(directory, 'collected-tests.json') }, directory);
}

export function verifyRepositoryInventory({ root, revision, input, candidates, manualRunners, exclusions }) {
  const collections = [], failures = [];
  const attempt = (name, read) => {
    try { collections.push(...read()); }
    catch (error) { failures.push(`${name}: ${error.message}`); }
  };
  const read = file => JSON.parse(readFileSync(file, 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(revision ?? '')) throw new Error('Invalid inventory revision');
  for (const descriptor of vitestInventoryArtifacts(revision)) {
    attempt(descriptor.runner, () => [readVitestInventoryArtifact({ input, root, revision, descriptor })]);
  }
  for (const [runner, artifact] of [['node-tooling', 'node-tooling'], ['appliance', 'appliance-node']]) {
    attempt(runner, () => {
      const directory = path.join(input, `${artifact}-${revision}`);
      const evidence = read(path.join(directory, 'evidence.json'));
      requireInventorySource(evidence.source, revision);
      return [readRunnerCollection({ runner, owner: 'Tooling maintainers', runtime: 'Node', mandatory: true,
        status: 'passed', format: 'node-events', sourceRoot: evidence.sourceRoot,
        collectionFile: path.join(directory, 'events.jsonl'), evidenceFile: path.join(directory, 'evidence.json') }, directory)];
    });
  }
  attempt('browser', () => {
    const directory = path.join(input, `browser-discovery-${revision}`);
    const evidence = read(path.join(directory, 'evidence.json'));
    requireInventorySource({ before: evidence.sourceBefore, after: evidence.sourceAfter }, revision);
    if (evidence.status !== 'passed' || evidence.executionVerified !== false) throw new Error('Browser collection failed or claims execution');
    return ['teams-development', 'supported-upgrade', 'server-legacy', 'enterprise-legacy', 'enterprise-deploy', 'production-community', 'production-enterprise']
      .map(runner => readRunnerCollection({ runner, owner: 'Browser and domain maintainers', runtime: 'Playwright',
        mandatory: true, status: 'passed', format: 'playwright', sourceRoot: evidence.sourceRoot,
        collectionFile: path.join(directory, `${runner}.json`) }, directory));
  });
  attempt('manual', () => {
    const directory = path.join(input, 'manual-test-inventory');
    const evidence = read(path.join(directory, 'evidence.json'));
    requireInventorySource(evidence.source, revision);
    if (evidence.status !== 'passed' || evidence.executionVerified !== false) throw new Error('Manual collection failed or claims execution');
    return manualRunners.map(runner => {
      const date = runner.expires;
      if (runner.mandatory !== false || !runner.owner?.trim() || !runner.runtime?.trim() || !runner.reason?.trim()
        || !runner.issue?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '') || !Number.isFinite(Date.parse(`${date}T00:00:00Z`))
        || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date || date <= new Date().toISOString().slice(0, 10)) {
        throw new Error(`Manual suite requires an owned, unexpired review: ${runner.runner}`);
      }
      return readRunnerCollection({ ...runner, status: 'passed', format: 'vitest', sourceRoot: evidence.sourceRoot,
        collectionFile: path.join(directory, runner.runner, 'collected.json'),
        casesFile: path.join(directory, runner.runner, 'collected-tests.json') }, directory);
    });
  });
  const result = reconcileDiscovery({ root, candidates, collections, exclusions });
  result.failures.push(...failures);
  return { ...result, revision, scope: 'repository-inventory', executionVerified: false,
    status: result.failures.length ? 'failed' : 'passed',
    runners: collections.map(({ runner, owner, runtime, mandatory, reason, issue, expires }) =>
      ({ runner, owner, runtime, mandatory, reason, issue, expires })) };
}
