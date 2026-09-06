import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAdditionalWorkspaceTest, isWorkspaceDbTest, reconcileDiscovery } from '../lib/test-discovery.mjs';

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
    'server/migrations/__tests__/rollback.integration.test.ts',
    'packages/billing/tests/eligibility.db.test.ts',
    'shared/workflow/tests/identity.db.test.ts',
    'ee/packages/calendar/tests/provider.db.test.tsx',
    'ee/server/src/__tests__/unit/huduAssetMappingActions.db.test.ts',
  ]) assert.equal(isWorkspaceDbTest(file), true, file);
  for (const file of [
    'server/src/test/integration/rollback.db.test.ts',
    'server/src/test/infrastructure/fixture.db.test.ts',
    'packages/billing/tests/eligibility.test.ts',
    'tools/fixture.db.test.ts',
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
  for (const root of ['services/email-service', 'services/workflow-worker', 'sdk/extension-runtime', 'ee/server/src/lib']) {
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.test.ts`, 'workspace-unit'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.spec.tsx`, 'workspace-unit'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.integration.test.ts`, 'workspace-unit'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.integration.test.ts`, 'workspace-runtime'), true);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.test.ts`, 'workspace-runtime'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/dist/behavior.test.js`, 'workspace-unit'), false);
    assert.equal(isAdditionalWorkspaceTest(`${root}/src/behavior.db.test.ts`, 'workspace-unit'), false);
  }
  assert.equal(isAdditionalWorkspaceTest('packages/billing/src/example.test.ts', 'workspace-unit'), false);
  assert.throws(() => isAdditionalWorkspaceTest('sdk/example.test.ts', 'unknown'), /Unknown workspace lane/);
});
