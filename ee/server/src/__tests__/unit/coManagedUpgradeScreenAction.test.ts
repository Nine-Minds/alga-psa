import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({ access: vi.fn(), screen: vi.fn(), requireCap: vi.fn(async () => undefined), Unavailable: class extends Error {} }));
const Unavailable = m.Unavailable;
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u' }, { tenant: 't1' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: async () => ({ knex: {} }) }));
vi.mock('@alga-psa/core/capability/server', () => ({ requireCapabilityForAction: m.requireCap, CapabilityUnavailableError: m.Unavailable }));
vi.mock('@alga-psa/co-managed', () => ({ resolveCoManagedUpgradeAccess: m.access, getCoManagedIndependentUpgradeScreen: m.screen,
  prepareCoManagedIndependentUpgrade: vi.fn() }));
vi.mock('server/src/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async () => ({ tenant: 't1' }) }));
vi.mock('../../lib/tenant-management/workflowClient', () => ({ startTenantProductUpgradeWorkflow: vi.fn(), getTenantProductUpgradeStatus: vi.fn() }));

import { getCoManagedUpgradeScreenAction, startCoManagedUpgradeAction } from '../../lib/actions/coManagedUpgradeActions';

beforeEach(() => { m.access.mockReset(); m.screen.mockReset(); m.requireCap.mockReset(); m.requireCap.mockResolvedValue(undefined); });

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
  it('mutating actions stay serves-gated', async () => {
    m.requireCap.mockRejectedValue(new Unavailable());
    await expect((startCoManagedUpgradeAction as any)({})).rejects.toBeInstanceOf(Unavailable);
    expect(m.requireCap).toHaveBeenCalledWith('co-managed', 't1', 'serves');
  });
});
