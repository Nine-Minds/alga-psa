import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedProvisioningError } from '@alga-psa/co-managed';
import { provisionCoManagedWorkspaceAction, retryCoManagedProvisioningAction } from '../../lib/actions/coManagedProvisioningActions';
const mocks = vi.hoisted(() => ({ permission: vi.fn(), prepare: vi.fn(), schedule: vi.fn(), invitation: vi.fn(), browser: vi.fn(),
  user: { tenant: 'home-sponsor', user_id: 'home-admin', user_type: 'internal' }, db: {}, rows: {} as Record<string, any[]> }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: mocks.db }), tenantDb: (_db: any, tenant: string) => ({
  table: (name: string) => {
    let rows = mocks.rows[`${tenant}:${name}`] || [];
    const query: any = { where: (key: string, value: string) => { rows = rows.filter(row => row[key] === value); return query; },
      first: async () => rows[0] };
    return query;
  },
}) }));
vi.mock('@alga-psa/co-managed', () => ({ prepareCoManagedProvisioning: mocks.prepare, retryCoManagedInitialAdministratorInvitation: mocks.invitation, CoManagedProvisioningError: class extends Error {} }));
vi.mock('server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: mocks.browser }));
vi.mock('../../lib/co-managed/workflowClient', () => ({ startCoManagedProvisioningWorkflow: mocks.schedule }));
beforeEach(() => { vi.resetAllMocks(); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true);
  mocks.prepare.mockResolvedValue({ operation_id: 'operation', state: 'queued' }); mocks.schedule.mockResolvedValue({ enqueued: true });
  mocks.browser.mockResolvedValue({ kind: 'session', tenant: 'home-sponsor', userId: 'home-admin', sessionId: 'tracked-session' });
  mocks.rows = { 'home-sponsor:tenants': [{ product_code: 'psa' }] }; });
describe('sponsor provisioning authentication adapter', () => {
  it('overrides forged sponsor and actor fields before reserving, and schedules only the persisted operation', async () => {
    const input: any = { sponsorTenant: 'other-sponsor', requestedBy: 'forged-user', operationId: 'requested-operation' };
    expect(await provisionCoManagedWorkspaceAction(input)).toEqual({ operationId: 'operation', enqueued: true });
    expect(mocks.prepare).toHaveBeenCalledWith(mocks.db, { sponsorTenant: 'home-sponsor', requestedBy: 'home-admin', operationId: 'requested-operation' });
    expect(mocks.schedule).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId: 'operation' });
  });
  it.each(['co_management', 'client', 'ticket'])('requires %s permission before provisioning', async resource => {
    mocks.permission.mockImplementation(async (_user, checked) => checked !== resource);
    await expect(provisionCoManagedWorkspaceAction({} as any)).rejects.toThrow('Permission denied');
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('denies requester creation and retry even with an allowing permission adapter', async () => {
    mocks.user.user_type = 'client';
    await expect(provisionCoManagedWorkspaceAction({} as any)).rejects.toThrow('Permission denied');
    await expect(retryCoManagedProvisioningAction('operation')).rejects.toThrow('Permission denied');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('retains the operation identity when the workflow service is unavailable', async () => {
    mocks.schedule.mockResolvedValue({ enqueued: false });
    expect(await provisionCoManagedWorkspaceAction({} as any)).toEqual({ operationId: 'operation', enqueued: false });
  });
  it('never schedules a worker when reservation fails or cleanup has begun', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('No seats'));
    await expect(provisionCoManagedWorkspaceAction({} as any)).rejects.toThrow('No seats');
    mocks.prepare.mockResolvedValue({ operation_id: 'operation', state: 'cleanup_requested' });
    await expect(provisionCoManagedWorkspaceAction({} as any)).rejects.toThrow('cancelled');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe('retry ownership and acknowledged domain failures', () => {
  const operationId = 'a0000000-0000-4000-8000-000000000001';
  it('prepares an initial invitation retry with the tracked home actor before scheduling the same operation', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    expect(await retryCoManagedProvisioningAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.invitation).toHaveBeenCalledWith(mocks.db, await mocks.browser.mock.results[0].value, operationId);
    expect(mocks.schedule).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId });
    expect(mocks.invitation.mock.invocationCallOrder[0]).toBeLessThan(mocks.schedule.mock.invocationCallOrder[0]);
  });
  it('never schedules invitation recovery after tracked-session or invitation admission fails', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    mocks.browser.mockRejectedValueOnce(new Error('Session changed'));
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toThrow('Session changed');
    mocks.invitation.mockRejectedValueOnce(new Error('Invitation already used'));
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toThrow('Invitation already used');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('retries only an operation owned by the authenticated sponsor', async () => {
    mocks.rows['other-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'failed' }];
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toThrow('cannot be retried');
    expect(mocks.schedule).not.toHaveBeenCalled();
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'failed' }];
    expect(await retryCoManagedProvisioningAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.schedule).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId });
  });
  it.each(['cleanup_requested', 'cancelled'])('does not restart %s operations', async state => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state }];
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toThrow('cannot be retried');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('reports a domain rejection without pretending the workflow was scheduled', async () => {
    mocks.prepare.mockRejectedValue(Object.assign(new CoManagedProvisioningError('INVALID_REQUEST'), { code: 'INVALID_REQUEST' }));
    expect(await provisionCoManagedWorkspaceAction({ operationId } as any)).toEqual({ operationId, rejected: true, errorCode: 'INVALID_REQUEST' });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});
