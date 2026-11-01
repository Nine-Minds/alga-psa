import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ access: vi.fn(), screen: vi.fn(), prepare: vi.fn(), requireCap: vi.fn(async () => undefined), Unavailable: class extends Error {} }));
const Unavailable = m.Unavailable;
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u' }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: m.requireCap, CapabilityUnavailableError: m.Unavailable }));
vi.mock('@alga-psa/co-managed', () => ({ resolveCoManagedUpgradeAccess: m.access, getCoManagedIndependentUpgradeScreen: m.screen,
  prepareCoManagedIndependentUpgrade: m.prepare }));
vi.mock('server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ tenant: 't1' }) }));
vi.mock('../../lib/tenant-management/workflowClient', () => ({ startTenantProductUpgradeWorkflow: vi.fn(), getTenantProductUpgradeStatus: vi.fn() }));

import { getCoManagedUpgradeScreenAction, startCoManagedUpgradeAction, purchaseCoManagedUpgradeAction,
  retryCoManagedUpgradePaymentAction, manageCoManagedUpgradeBillingAction } from '../../lib/actions/coManagedUpgradeActions';

beforeEach(() => { m.access.mockReset(); m.screen.mockReset(); m.prepare.mockReset(); m.requireCap.mockReset(); m.requireCap.mockResolvedValue(undefined); });

describe('getCoManagedUpgradeScreenAction', () => {
  it('returns completed for a former customer without consulting the serves gate', async () => {
    m.access.mockResolvedValue('former');
    m.screen.mockResolvedValue({ state: 'completed', operationId: 'op' });
    await expect((getCoManagedUpgradeScreenAction as any)()).resolves.toMatchObject({ state: 'completed', operationId: 'op', progress: 'completed' });
    expect(m.requireCap).not.toHaveBeenCalled();
  });
  it('refuses when the shared gate is closed (sponsor, kill switch, flag off)', async () => {
    m.access.mockResolvedValue('closed');
    await expect((getCoManagedUpgradeScreenAction as any)()).rejects.toBeInstanceOf(Unavailable);
    expect(m.screen).not.toHaveBeenCalled();
  });
  it.each(['closed', 'former'])('every mutating action refuses unless the shared gate says customer (%s)', async (access) => {
    m.access.mockResolvedValue(access);
    for (const action of [startCoManagedUpgradeAction, purchaseCoManagedUpgradeAction, retryCoManagedUpgradePaymentAction, manageCoManagedUpgradeBillingAction]) {
      await expect((action as any)({})).rejects.toBeInstanceOf(Unavailable);
    }
    expect(m.access).toHaveBeenCalledTimes(4);
    expect(m.access).toHaveBeenCalledWith({}, 't1');
  });
  it('a current customer passes the gate into the domain', async () => {
    m.access.mockResolvedValue('customer');
    m.prepare.mockResolvedValue({ kind: 'completed' });
    await expect((startCoManagedUpgradeAction as any)({ relationshipId: 'r', operationId: 'o', expectedRevision: 1 }))
      .resolves.toEqual({ completed: true, enqueued: false });
    expect(m.prepare).toHaveBeenCalledOnce();
  });
});
