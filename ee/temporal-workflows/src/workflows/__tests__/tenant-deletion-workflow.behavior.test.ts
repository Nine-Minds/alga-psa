import { beforeEach, expect, it, vi } from 'vitest';
import type { TenantDeletionInput } from '../../types/tenant-deletion-types';

const harness = vi.hoisted(() => ({
  calls: [] as string[],
  handlers: new Map<string, (value?: any) => any>(),
  activities: new Map<string, ReturnType<typeof vi.fn>>(),
  patched: true,
  rollback: false,
}));
vi.mock('@temporalio/workflow', () => ({
  proxyActivities: () => new Proxy({}, { get: (_target, name: string) => {
    if (!harness.activities.has(name)) harness.activities.set(name, vi.fn());
    return harness.activities.get(name);
  } }),
  defineSignal: (name: string) => name,
  defineQuery: (name: string) => name,
  setHandler: (name: string, handler: (value?: any) => any) => harness.handlers.set(name, handler),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  patched: () => harness.patched,
  uuid4: () => 'deletion-fixture',
  workflowInfo: () => ({ workflowId: 'deletion-workflow-fixture', firstExecutionRunId: 'first-run' }),
  executeChild: async () => ({ success: true, exportId: 'export-fixture', bucket: 'synthetic', s3Key: 'tenant-backup' }),
  sleep: vi.fn(),
  condition: async (predicate: () => boolean) => {
    if (harness.rollback) harness.handlers.get('rollbackDeletion')!({ reason: 'Test rollback', rolledBackBy: 'operator' });
    return predicate();
  },
}));
import { tenantDeletionWorkflow } from '../tenant-deletion-workflow';

beforeEach(() => {
  harness.calls.length = 0;
  harness.handlers.clear();
  harness.patched = true;
  harness.rollback = false;
  const outputs: Record<string, unknown> = {
    validateTenantDeletion: { valid: true }, getTenantName: 'Synthetic tenant',
    cancelTenantStripeSubscription: { canceled: true }, deleteTenantData: { success: true },
    deleteTenantSchedules: { deletedScheduleIds: ['schedule-fixture'] },
  };
  for (const [name, activity] of harness.activities) {
    activity.mockReset().mockImplementation(async () => { harness.calls.push(name); return outputs[name] ?? {}; });
  }
});
const input = (triggerSource: TenantDeletionInput['triggerSource'] = 'manual') => ({ tenantId: 'tenant-fixture', triggerSource });
const relevant = (names: string[]) => harness.calls.filter(name => names.includes(name));

it.each(['manual', 'nineminds_extension', 'stripe_webhook', 'apple_iap_webhook'] as const)(
  'suspends all tenant activity before trigger-specific work and tears down providers before deleting data (%s)', async trigger => {
    expect(await tenantDeletionWorkflow(input(trigger))).toMatchObject({ success: true, status: 'deleted' });
    const expected = ['deactivateAllTenantUsers', 'suspendTenantEmailIngestion', 'suspendTenantBackgroundActivity'];
    if (trigger === 'manual' || trigger === 'nineminds_extension') expected.push('cancelTenantStripeSubscription');
    expected.push('deleteTenantSchedules', 'teardownTenantEmailIngestion', 'deleteTenantData');
    expect(relevant([...expected, 'cancelTenantStripeSubscription'])).toEqual(expected);
    expect(harness.activities.get('deleteTenantData')).toHaveBeenCalledWith('tenant-fixture', 'deletion-fixture');
    expect(harness.handlers.get('getDeletionState')!()).toMatchObject({ status: 'deleted', step: 'completed' });
  },
);

it.each([undefined, 'resumeTenantEmailIngestion', 'resumeTenantBackgroundActivity'])(
  'rollback reactivates users then resumes services, containing failure in %s', async failingActivity => {
    harness.rollback = true;
    if (failingActivity) harness.activities.get(failingActivity)!.mockImplementation(async () => {
      harness.calls.push(failingActivity); throw new Error('Synthetic provider unavailable');
    });
    expect(await tenantDeletionWorkflow(input())).toMatchObject({ success: true, status: 'rolled_back' });
    expect(relevant(['reactivateTenantUsers', 'resumeTenantEmailIngestion', 'resumeTenantBackgroundActivity', 'removeClientCanceledTag', 'reactivateMasterTenantClient'])).toEqual([
      'reactivateTenantUsers', 'resumeTenantEmailIngestion', 'resumeTenantBackgroundActivity', 'removeClientCanceledTag', 'reactivateMasterTenantClient',
    ]);
    expect(harness.activities.get('deleteTenantData')).not.toHaveBeenCalled();
    expect(harness.activities.get('updateDeletionStatus')).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'rolled_back' }));
  },
);

it('continues deletion after provider teardown fails', async () => {
  harness.activities.get('teardownTenantEmailIngestion')!.mockImplementation(async () => {
    harness.calls.push('teardownTenantEmailIngestion'); throw new Error('Synthetic teardown failure');
  });
  expect(await tenantDeletionWorkflow(input())).toMatchObject({ status: 'deleted' });
  expect(relevant(['teardownTenantEmailIngestion', 'deleteTenantData'])).toEqual(['teardownTenantEmailIngestion', 'deleteTenantData']);
});

it.each([false, true])('omits newly patched suspension/resume activities on a legacy path (rollback=%s)', async rollback => {
  harness.patched = false;
  harness.rollback = rollback;
  expect(await tenantDeletionWorkflow(input())).toMatchObject({ status: rollback ? 'rolled_back' : 'deleted' });
  for (const name of ['suspendTenantEmailIngestion', 'suspendTenantBackgroundActivity', 'resumeTenantEmailIngestion', 'resumeTenantBackgroundActivity', 'teardownTenantEmailIngestion']) {
    expect(harness.activities.get(name)).not.toHaveBeenCalled();
  }
});
