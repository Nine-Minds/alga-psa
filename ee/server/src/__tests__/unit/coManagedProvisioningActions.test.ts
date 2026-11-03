import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CoManagedProvisioningError } from '@alga-psa/co-managed';
import { provisionCoManagedWorkspaceAction, retryCoManagedProvisioningAction, resendCoManagedAdministratorInvitationAction, cancelCoManagedProvisioningAction } from '../../lib/actions/coManagedProvisioningActions';
const mocks = vi.hoisted(() => ({ capability: vi.fn(), permission: vi.fn(), prepare: vi.fn(), schedule: vi.fn(), invitation: vi.fn(), browser: vi.fn(), admission: vi.fn(), cancel: vi.fn(), cleanup: vi.fn(),
  user: { tenant: 'home-sponsor', user_id: 'home-admin', user_type: 'internal' }, db: {}, rows: {} as Record<string, any[]> }));
vi.mock('@alga-psa/auth', () => ({ withAuth: (handler: any) => (...args: any[]) => handler(mocks.user, { tenant: mocks.user.tenant }, ...args) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: mocks.capability }));
vi.mock('@alga-psa/auth/rbac', () => ({ hasPermission: mocks.permission }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: mocks.db }), tenantDb: (_db: any, tenant: string) => ({
  table: (name: string) => {
    let rows = mocks.rows[`${tenant}:${name}`] || [];
    const query: any = { where: (key: string, value: string) => { rows = rows.filter(row => row[key] === value); return query; },
      first: async () => rows[0] };
    return query;
  },
}) }));
vi.mock('@alga-psa/co-managed', () => ({ prepareCoManagedProvisioningForActor: mocks.prepare, withCoManagedManagementOperation: mocks.admission, requestCoManagedProvisioningCleanup: mocks.cancel, retryCoManagedInitialAdministratorInvitation: mocks.invitation, CoManagedProvisioningError: class extends Error { constructor(public code?: string) { super(code); } } }));
vi.mock('@alga-psa/licensing', () => ({ CoManagedReservationError: class extends Error {} }));
vi.mock('server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: mocks.browser }));
vi.mock('server/src/lib/co-managed/admitSponsor', () => ({ admitCoManagedSponsor: vi.fn() }));
vi.mock('../../lib/co-managed/workflowClient', () => ({ startCoManagedProvisioningWorkflow: mocks.schedule, startCoManagedProvisioningCleanupWorkflow: mocks.cleanup }));
beforeEach(() => { vi.resetAllMocks(); mocks.capability.mockResolvedValue(undefined); mocks.user.user_type = 'internal'; mocks.permission.mockResolvedValue(true);
  mocks.prepare.mockResolvedValue({ operation_id: 'operation', state: 'queued' }); mocks.schedule.mockResolvedValue({ enqueued: true }); mocks.cleanup.mockResolvedValue({ enqueued: true });
  mocks.browser.mockResolvedValue({ kind: 'session', tenant: 'home-sponsor', userId: 'home-admin', sessionId: 'tracked-session' });
  mocks.rows = { 'home-sponsor:tenants': [{ product_code: 'psa' }] };
  mocks.admission.mockImplementation(async (_db, actor, id, callback) => {
    const operation = (mocks.rows[`${actor.tenant}:co_managed_provisioning_operations`] || []).find(row => row.operation_id === id);
    if (!operation) throw new Error('This operation cannot be retried');
    return callback(mocks.db, operation);
  });
});
const BOARD = 'b0000000-0000-4000-8000-000000000002';
const valid = { operationId: 'requested-operation', clientId: 'client', workspaceName: 'Customer', administratorName: 'Ada  Lovelace King',
  administratorEmail: 'ada@example.com', seats: 3, visibilityMode: 'board_scope' as const, escalationBoardId: BOARD };
describe('sponsor provisioning authentication adapter', () => {
  it('overrides forged sponsor and actor fields before reserving, and schedules only the persisted operation', async () => {
    const input: any = { ...valid, sponsorTenant: 'other-sponsor', requestedBy: 'forged-user' };
    expect(await provisionCoManagedWorkspaceAction(input)).toEqual({ operationId: 'operation', enqueued: true });
    expect(mocks.prepare).toHaveBeenCalledWith(mocks.db, await mocks.browser.mock.results[0].value, { operationId: 'requested-operation',
      clientId: 'client', workspaceName: 'Customer', administrator: { firstName: 'Ada', lastName: 'Lovelace King', email: 'ada@example.com' },
      escalationBoardId: BOARD, seats: 3, visibilityMode: 'board_scope' });
    expect(mocks.schedule).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId: 'operation' });
  });
  it('rejects a single-token administrator name or missing board without reserving', async () => {
    expect(await provisionCoManagedWorkspaceAction({ ...valid, administratorName: 'Ada' })).toMatchObject({ rejected: true, errorCode: 'INVALID_REQUEST' });
    expect(await provisionCoManagedWorkspaceAction({ ...valid, escalationBoardId: undefined })).toMatchObject({ rejected: true, errorCode: 'INVALID_REQUEST' });
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('checks the capability gate first: a closed gate stops every action before permission, session or database work', async () => {
    mocks.capability.mockRejectedValue(new Error('closed'));
    const id = 'a0000000-0000-4000-8000-000000000001';
    for (const call of [() => provisionCoManagedWorkspaceAction(valid), () => retryCoManagedProvisioningAction(id),
      () => resendCoManagedAdministratorInvitationAction(id), () => cancelCoManagedProvisioningAction(id)])
      await expect(call()).rejects.toThrow('closed');
    expect(mocks.capability).toHaveBeenCalledWith('co-managed', 'home-sponsor', 'admits');
    expect(mocks.permission).not.toHaveBeenCalled(); expect(mocks.browser).not.toHaveBeenCalled(); expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it.each(['co_management', 'client', 'ticket'])('requires %s permission before provisioning', async resource => {
    mocks.permission.mockImplementation(async (_user, checked) => checked !== resource);
    await expect(provisionCoManagedWorkspaceAction(valid)).rejects.toThrow('Permission denied');
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('denies requester creation and retry even with an allowing permission adapter', async () => {
    mocks.user.user_type = 'client';
    await expect(provisionCoManagedWorkspaceAction(valid)).rejects.toThrow('Permission denied');
    await expect(retryCoManagedProvisioningAction('operation')).rejects.toThrow('Permission denied');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('does not schedule creation or ordinary retry when the tracked session is unavailable', async () => {
    mocks.browser.mockRejectedValue(new Error('Session changed'));
    await expect(provisionCoManagedWorkspaceAction(valid)).rejects.toThrow('Session changed');
    await expect(retryCoManagedProvisioningAction('a0000000-0000-4000-8000-000000000001')).rejects.toThrow('Session changed');
    expect(mocks.prepare).not.toHaveBeenCalled(); expect(mocks.admission).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('retains the operation identity when the workflow service is unavailable', async () => {
    mocks.schedule.mockResolvedValue({ enqueued: false });
    expect(await provisionCoManagedWorkspaceAction(valid)).toEqual({ operationId: 'operation', enqueued: false });
  });
  it('never schedules a worker when reservation fails or cleanup has begun', async () => {
    mocks.prepare.mockRejectedValueOnce(new Error('No seats'));
    await expect(provisionCoManagedWorkspaceAction(valid)).rejects.toThrow('No seats');
    mocks.prepare.mockResolvedValue({ operation_id: 'operation', state: 'cleanup_requested' });
    await expect(provisionCoManagedWorkspaceAction(valid)).resolves.toMatchObject({ rejected: true, errorCode: 'SETUP_CANCELLING' });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe('retry ownership and acknowledged domain failures', () => {
  const operationId = 'a0000000-0000-4000-8000-000000000001';
  it('prepares an initial invitation retry with the tracked home actor before scheduling the same operation', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    expect(await retryCoManagedProvisioningAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.invitation).toHaveBeenCalledWith(mocks.db, await mocks.browser.mock.results[0].value, operationId);
    expect(mocks.invitation.mock.calls[0][3]).toBeUndefined();
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
  it('does not schedule another delivery when general retry reaches the resend limit', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    mocks.invitation.mockRejectedValueOnce(new CoManagedProvisioningError('RESEND_LIMIT_REACHED' as any));
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toMatchObject({ code: 'RESEND_LIMIT_REACHED' });
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
  it.each(['cancelled'])('does not restart %s operations', async state => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state }];
    await expect(retryCoManagedProvisioningAction(operationId)).rejects.toThrow('cannot be retried');
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('reports a domain rejection without pretending the workflow was scheduled', async () => {
    mocks.prepare.mockRejectedValue(Object.assign(new CoManagedProvisioningError('INVALID_REQUEST'), { code: 'INVALID_REQUEST' }));
    expect(await provisionCoManagedWorkspaceAction({ ...valid, operationId })).toEqual({ operationId, rejected: true, errorCode: 'INVALID_REQUEST' });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe('invitation resend', () => {
  const operationId = 'a0000000-0000-4000-8000-000000000001';
  it('retains the invitation, then schedules delivery of the same operation', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    expect(await resendCoManagedAdministratorInvitationAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.invitation).toHaveBeenCalledWith(mocks.db, await mocks.browser.mock.results[0].value, operationId);
    expect(mocks.schedule).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId });
  });
  it('reports the resend limit as a rejection and never schedules', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    mocks.invitation.mockRejectedValueOnce(new CoManagedProvisioningError('RESEND_LIMIT_REACHED' as any));
    expect(await resendCoManagedAdministratorInvitationAction(operationId)).toEqual({ rejected: true, errorCode: 'RESEND_LIMIT_REACHED' });
    expect(mocks.schedule).not.toHaveBeenCalled();
  });
  it('refuses operations that are not awaiting acceptance', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'failed' }];
    await expect(resendCoManagedAdministratorInvitationAction(operationId)).rejects.toThrow('cannot be retried');
    expect(mocks.invitation).not.toHaveBeenCalled(); expect(mocks.schedule).not.toHaveBeenCalled();
  });
});

describe('provisioning cleanup authentication and scheduling', () => {
  const operationId = 'a0000000-0000-4000-8000-000000000001';
  it('persists cancellation under policy admission before scheduling the canonical cleanup identity', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'failed' }];
    expect(await cancelCoManagedProvisioningAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.cancel).toHaveBeenCalledWith(mocks.db, 'home-sponsor', operationId);
    expect(mocks.cleanup).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId });
    expect(mocks.cancel.mock.invocationCallOrder[0]).toBeLessThan(mocks.cleanup.mock.invocationCallOrder[0]);
    expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.invitation).not.toHaveBeenCalled();
  });
  it('resumes cleanup through the existing retry action without restarting bootstrap or renewing invitations', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'cleanup_requested' }];
    mocks.cleanup.mockResolvedValueOnce({ enqueued: false });
    expect(await retryCoManagedProvisioningAction(operationId)).toEqual({ enqueued: false });
    expect(mocks.cleanup).toHaveBeenCalledWith({ sponsorTenant: 'home-sponsor', operationId });
    expect(mocks.schedule).not.toHaveBeenCalled(); expect(mocks.invitation).not.toHaveBeenCalled();
  });
  it('does not schedule cancellation for foreign, untracked or already-claimed authority', async () => {
    await expect(cancelCoManagedProvisioningAction(operationId)).rejects.toThrow();
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'pending_acceptance' }];
    mocks.browser.mockRejectedValueOnce(new Error('Session changed'));
    await expect(cancelCoManagedProvisioningAction(operationId)).rejects.toThrow('Session changed');
    mocks.cancel.mockRejectedValueOnce(new Error('Administrator claimed'));
    await expect(cancelCoManagedProvisioningAction(operationId)).rejects.toThrow('Administrator claimed');
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
  it('returns an acknowledged cancelled operation without creating another cleanup workflow', async () => {
    mocks.rows['home-sponsor:co_managed_provisioning_operations'] = [{ operation_id: operationId, state: 'cancelled' }];
    expect(await cancelCoManagedProvisioningAction(operationId)).toEqual({ enqueued: true });
    expect(mocks.cleanup).not.toHaveBeenCalled();
  });
});
