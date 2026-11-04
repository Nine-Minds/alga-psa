import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAdditionalWorkspaceTest, isNodeToolingTest, isWorkspaceDbTest, reconcileDiscovery, repositoryTestFiles } from '../lib/test-discovery.mjs';
import { serverUnitSelection } from '../run-server-unit-shard.mjs';

function inspect(overrides = {}) {
  return reconcileDiscovery({
    root: '/repo', today: '2026-09-06',
    candidates: ['tests/paid.test.ts'],
    collections: [{ runner: 'billing', status: 'passed', files: [{ file: '/repo/tests/paid.test.ts' }] }],
    ...overrides,
  });
}

test('inventory identifies uncollected additions and moves independently of a successful runner', () => {
  assert.equal(inspect().status, 'passed');
  const added = inspect({ candidates: ['tests/paid.test.ts', 'outside/tenant.test.ts'] });
  assert.equal(added.status, 'failed');
  assert.deepEqual(added.unmatched, ['outside/tenant.test.ts']);
  const moved = inspect({ candidates: ['moved/paid.test.ts'] });
  assert.equal(moved.status, 'failed');
  assert.deepEqual(moved.unmatched, ['moved/paid.test.ts']);
  assert.ok(moved.failures.some((failure) => failure.includes('outside candidate inventory')));
});

test('empty, missing, failed and duplicate runner collections cannot satisfy discovery', () => {
  for (const override of [
    { candidates: [] }, { collections: [] },
    { collections: [{ runner: 'billing', status: 'passed', files: [] }] },
    { collections: [{ runner: 'billing', status: 'failed', files: ['tests/paid.test.ts'] }] },
    { collections: [{ runner: 'billing', status: 'passed', files: ['tests/paid.test.ts', 'tests/paid.test.ts'] }] },
  ]) assert.equal(inspect(override).status, 'failed');
});

test('manual exclusions are explicit, owned, dated and tied to existing uncollected tests', () => {
  const exclusion = { file: 'visual/manual.test.ts', owner: 'test-maintainer', issue: 'https://example.invalid/issue/1', reason: 'Requires physical display for manual verification', expires: '2026-09-20' };
  const withExclusion = (entry) => inspect({ candidates: ['tests/paid.test.ts', exclusion.file], exclusions: [entry] });
  const result = withExclusion(exclusion);
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.tests[1], { file: exclusion.file, runners: [], exclusion });
  for (const patch of [{ expires: '2026-09-06' }, { expires: '2026-02-30' }, { expires: '' }, { owner: '' }, { reason: '' }, { issue: '' }, { file: 'removed.test.ts' }]) {
    assert.equal(withExclusion({ ...exclusion, ...patch }).status, 'failed');
  }
  assert.equal(inspect({ exclusions: [{ ...exclusion, file: 'tests/paid.test.ts' }] }).status, 'failed');
});

test('identities outside the workspace cannot be counted as discovered tests', () => {
  for (const file of ['../outside.test.ts', '/outside.test.ts', '/repo']) {
    assert.throws(() => inspect({ candidates: [file] }), /outside the repository/);
  }
});

test('DB-less unit exclusions receive a dedicated DB lane without taking over other lanes', () => {
  for (const file of [
    'server/src/test/unit/migrations/rollback.db.test.ts',
    'server/src/test/contract/hotPathQueryBudget.db.test.ts',
    'server/migrations/__tests__/rollback.integration.test.ts',
    'packages/billing/tests/eligibility.db.test.ts',
    'shared/workflow/tests/identity.db.test.ts',
    'ee/packages/calendar/tests/provider.db.test.tsx',
    'ee/server/src/__tests__/unit/huduAssetMappingActions.db.test.ts',
    'services/workflow-worker/src/v2/launchSkips.db.test.ts',
  ]) assert.equal(isWorkspaceDbTest(file), true, file);
  for (const file of [
    'server/src/test/integration/rollback.db.test.ts',
    'server/src/test/infrastructure/fixture.db.test.ts',
    'server/src/test/contract/hotPathScenario.test.ts',
    'packages/billing/tests/eligibility.test.ts',
    'tools/fixture.db.test.ts',
    'services/workflow-worker/dist/v2/launchSkips.db.test.js',
  ]) assert.equal(isWorkspaceDbTest(file), false, file);
});

test('service and SDK inventory assigns unit and runtime suites without counting build output', () => {
  assert.equal(isAdditionalWorkspaceTest('ee/server/src/__tests__/integration/scim.integration.test.ts', 'enterprise-integration'), true);
  assert.equal(isAdditionalWorkspaceTest('tools/nx-tests/nxCache.test.ts', 'nx-tooling'), true);
  assert.equal(isWorkspaceDbTest('server/src/lib/eventBus/subscribers/prepaidBalanceAlertSubscriber.integration.test.ts'), true);
  assert.equal(isWorkspaceDbTest('server/src/services/example.db.spec.tsx'), true);
  assert.equal(isWorkspaceDbTest('server/src/lib/example.test.ts'), false);
  assert.equal(isAdditionalWorkspaceTest('tools/nx-tests/vitest.config.ts', 'nx-tooling'), false);
  assert.equal(isAdditionalWorkspaceTest('ee/extensions/samples/ui-kit-showcase/test/integration.test.tsx', 'ui-kit-showcase'), true);
  assert.equal(isAdditionalWorkspaceTest('ee/extensions/samples/ui-kit-showcase/ui/dist/example.test.js', 'ui-kit-showcase'), false);
  assert.equal(isAdditionalWorkspaceTest('ee/server/src/__tests__/integration/extensionProxyFlow.test.ts', 'enterprise-integration'), true);
  assert.equal(isAdditionalWorkspaceTest('ee/server/src/__tests__/integration/login.playwright.test.ts', 'enterprise-integration'), false);
  assert.equal(isAdditionalWorkspaceTest('services/ai-gateway/src/test/integration/ledgerPersistence.test.ts', 'ai-gateway'), true);
  assert.equal(isAdditionalWorkspaceTest('services/ai-gateway/src/test/unit/auth.test.ts', 'ai-gateway'), true);
  assert.equal(isAdditionalWorkspaceTest('services/ai-gateway/dist/test/unit/auth.test.js', 'ai-gateway'), false);
  assert.equal(isAdditionalWorkspaceTest('ee/packages/workflows/src/lib/behavior.test.ts', 'enterprise-unit'), true);
  assert.equal(isAdditionalWorkspaceTest('ee/packages/workflows/src/lib/behavior.db.test.ts', 'enterprise-unit'), false);
  assert.equal(isAdditionalWorkspaceTest('ee/packages/workflows/src/lib/behavior.integration.test.ts', 'enterprise-unit'), false);
  assert.equal(isAdditionalWorkspaceTest('ee/packages/workflows/dist/behavior.test.js', 'enterprise-unit'), false);
  for (const root of ['services/email-service', 'services/workflow-worker', 'sdk/extension-runtime', 'ee/server/src/lib', 'scripts/dev/co-managed-fixtures']) {
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.test.ts`, 'workspace-unit'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.spec.tsx`, 'workspace-unit'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.integration.test.ts`, 'workspace-unit'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.integration.test.ts`, 'workspace-runtime'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.test.ts`, 'workspace-runtime'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/dist/behavior.test.js`, 'workspace-unit'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.db.test.ts`, 'workspace-unit'), false);
  }
  assert.equal(isAdditionalWorkspaceTest('packages/billing/src/example.test.ts', 'workspace-unit'), false);
  // node:test suites under scripts/tests belong to node-tooling, not this lane.
  assert.equal(isAdditionalWorkspaceTest('scripts/tests/test-discovery.test.mjs', 'workspace-unit'), false);
  assert.throws(() => isAdditionalWorkspaceTest('sdk/example.test.ts', 'unknown'), /Unknown workspace lane/);
});

test('questionnaire mapping deletion is required by the Temporal readiness inventory', () => {
  const file = 'ee/temporal-workflows/src/activities/__tests__/tenant-deletion-answer-mappings.test.ts';
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-engine'), false);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-database'), false);
  const candidates = [file].filter(candidate => isAdditionalWorkspaceTest(candidate, 'temporal-readiness'));
  assert.equal(inspect({ candidates, collections: [] }).status, 'failed');
});

test('relocated tenant deletion regressions remain required in the Temporal readiness lane', () => {
  const files = ['defaultTaxRate', 'workSchedule', 'teamsObservability'].map(name =>
    `ee/temporal-workflows/src/activities/__tests__/${name}TenantDeletionOrder.test.ts`);
  const candidates = files.filter(file => isAdditionalWorkspaceTest(file, 'temporal-readiness'));
  assert.deepEqual(candidates, files);
  const collected = { runner: 'temporal-readiness', status: 'passed', files };
  assert.equal(inspect({ candidates, collections: [collected] }).status, 'passed');
  for (const missing of files) {
    const result = inspect({ candidates, collections: [{ ...collected, files: files.filter(file => file !== missing) }] });
    assert.equal(result.status, 'failed');
    assert.deepEqual(result.unmatched, [missing]);
  }
});

test('HTTP locale rendering and fixture readback join API execution without absorbing browser suites', () => {
  assert.equal(isAdditionalWorkspaceTest('server/src/test/e2e/serverRenderedLocale.e2e.test.ts', 'api-e2e'), true);
  assert.equal(isAdditionalWorkspaceTest('server/src/test/e2e/utils/utilities.test.ts', 'api-e2e'), true);
  assert.equal(isAdditionalWorkspaceTest('server/src/test/e2e/api/clients.e2e.test.ts', 'api-e2e'), true);
  assert.equal(isAdditionalWorkspaceTest('server/src/test/e2e/document-system.playwright.test.ts', 'api-e2e'), false);
});

test('the mutation sandbox guard executes in the required Node tooling suite', () => {
  const file = 'tools/mutation/sandbox.test.mjs';
  assert.equal(isNodeToolingTest(file), true);
  assert.equal(isNodeToolingTest('tools/mutation/vitest.config.ts'), false);
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const mutationTests = repositoryTestFiles(root).filter(candidate => candidate.startsWith('tools/mutation/'));
  assert.ok(mutationTests.includes(file));
  assert.deepEqual(mutationTests.filter(candidate => !isNodeToolingTest(candidate)), []);
});


test('migration forwarding must execute in Temporal readiness', () => {
  const file = 'ee/temporal-workflows/src/activities/__tests__/migration-apply-forwarding.test.ts';
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-engine'), false);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-database'), false);
  const candidates = [file].filter(candidate => isAdditionalWorkspaceTest(candidate, 'temporal-readiness'));
  assert.equal(inspect({ candidates, collections: [] }).status, 'failed');
});

test('invoice auto-pay Temporal suites are assigned to the lanes that execute them', () => {
  const engine = [
    'ee/temporal-workflows/src/workflows/__tests__/invoice-autopay-workflow.test.ts',
    'ee/temporal-workflows/src/workflows/__tests__/autopay-reconcile-workflow.test.ts',
  ];
  for (const file of engine) {
    assert.equal(isAdditionalWorkspaceTest(file, 'temporal-engine'), true);
    assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), false);
  }
  const activities = 'ee/temporal-workflows/src/activities/__tests__/autopay-activities.test.ts';
  assert.equal(isAdditionalWorkspaceTest(activities, 'temporal-readiness'), true);
  assert.equal(isAdditionalWorkspaceTest(activities, 'temporal-engine'), false);
  for (const file of ['AutopayService', 'invoiceAutopayTemporal']) {
    assert.equal(isAdditionalWorkspaceTest(`ee/server/src/__tests__/unit/payments/${file}.test.ts`, 'enterprise-unit'), true);
  }
});

test('the portal-domain SSO redirect URI gate must execute in Temporal readiness', () => {
  const file = 'ee/temporal-workflows/src/activities/__tests__/portal-domain-redirect-uri-gate.test.ts';
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-engine'), false);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-database'), false);
  const candidates = [file].filter(candidate => isAdditionalWorkspaceTest(candidate, 'temporal-readiness'));
  assert.equal(inspect({ candidates, collections: [] }).status, 'failed');
});

test('every literal temporal readiness include is a temporal-readiness candidate', () => {
  const config = readFileSync(new URL('../../ee/temporal-workflows/vitest.readiness.config.ts', import.meta.url), 'utf8');
  const includes = [...config.matchAll(/'(src\/[^'*]+\.test\.ts)'/g)].map(([, file]) => `ee/temporal-workflows/${file}`);
  assert.ok(includes.length > 0);
  for (const file of includes) assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true, file);
});

// Temporal readiness runs without a database or Temporal server and requires
// executed assertions in every candidate file, so an env-gated suite there
// skips and fails the gate. Such suites belong to a lane providing their
// runtime, or to the manual registry.
test('no Temporal readiness candidate gates its cases on the environment', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const candidates = repositoryTestFiles(root).filter(file => isAdditionalWorkspaceTest(file, 'temporal-readiness'));
  assert.ok(candidates.length > 0);
  for (const file of candidates) {
    assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), /\.(skipIf|runIf)\(/, file);
  }
});

test('the env-gated tenant deletion query budget is collected only by its manual review runner', () => {
  const file = 'ee/temporal-workflows/src/activities/__tests__/tenantDeletionQueryBudget.test.ts';
  for (const lane of ['temporal-readiness', 'temporal-engine', 'temporal-database']) {
    assert.equal(isAdditionalWorkspaceTest(file, lane), false, lane);
  }
  const runners = JSON.parse(readFileSync(new URL('../manual-vitest-runners.json', import.meta.url), 'utf8'));
  const runner = runners.find(entry => entry.filters?.some(filter => `${entry.cwd}/${filter}` === file));
  assert.equal(runner?.mandatory, false);
  // vitest list omits skipped cases; collection must see the gated case.
  assert.equal(runner.env?.HOTPATH_DB, '1');
});

// The server unit shards run without a database (SKIP_DB_TESTS=1) and require
// executed assertions in every collected file, so a suite gated as a whole
// skips and fails the shard. Per-case gates still leave assertions executing.
test('no DB-less server unit candidate gates its whole suite on the environment', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const roots = serverUnitSelection.map(selection => path.posix.normalize(`server/${selection}/`));
  const candidates = repositoryTestFiles(root)
    .filter(file => roots.some(prefix => file.startsWith(prefix)) && !/\.db\.test\.[cm]?[jt]sx?$/.test(file));
  assert.ok(candidates.length > 0);
  for (const file of candidates) {
    assert.doesNotMatch(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'), /\bdescribe\.(skipIf|runIf)\(/, file);
  }
});

test('the env-gated server hot-path capture is collected only by its manual review runner', () => {
  const file = 'server/src/test/contract/hotPathQueryBudget.local.test.ts';
  assert.ok(!serverUnitSelection.some(selection => file.startsWith(path.posix.normalize(`server/${selection}/`))));
  assert.equal(isWorkspaceDbTest(file), false);
  const runners = JSON.parse(readFileSync(new URL('../manual-vitest-runners.json', import.meta.url), 'utf8'));
  const runner = runners.find(entry => entry.filters?.some(filter => `${entry.cwd}/${filter}` === file));
  assert.equal(runner?.mandatory, false);
  // vitest list omits skipped cases; collection must see the gated cases.
  assert.equal(runner.env?.HOTPATH_DB, '1');
});

test('worker boot under a failing capability gate must execute in Temporal readiness', () => {
  const file = 'ee/temporal-workflows/src/__tests__/worker.capabilityBoot.test.ts';
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-readiness'), true);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-engine'), false);
  assert.equal(isAdditionalWorkspaceTest(file, 'temporal-database'), false);
  const readinessConfig = readFileSync(new URL('../../ee/temporal-workflows/vitest.readiness.config.ts', import.meta.url), 'utf8');
  assert.ok(readinessConfig.includes("'src/__tests__/worker.capabilityBoot.test.ts'"));
});
