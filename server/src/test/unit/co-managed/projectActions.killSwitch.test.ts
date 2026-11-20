import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L3d neutrality. With the co-managed capability closed (the real gate, not a mock) every shared-project action
 * refuses before it resolves an actor or opens a connection, so a psa tenant pays no co_management_* query.
 * Every exported action is enumerated, so an action added without the gate fails here.
 */
const createTenantKnex = vi.fn();
const browserActor = vi.fn();
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a), tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/co-managed', async () => new Proxy({}, { get: (_t, name) => name === 'then' ? undefined : vi.fn() }));
vi.mock('@alga-psa/search/projectSearchAccess', () => ({ searchSharedProjects: vi.fn() }));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/co-managed/editProjectTask', () => ({ writeCoManagedSharedTask: vi.fn() }));

describe('L3d project actions under FORCE_CAPABILITIES=co-managed:off', () => {
  beforeEach(() => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    createTenantKnex.mockClear(); browserActor.mockClear();
  });

  it('every action refuses and touches no database or actor', async () => {
    const mod = await import('@/lib/actions/coManagedProjectTaskActions');
    const actions = Object.entries(mod).filter(([, value]) => typeof value === 'function');
    expect(actions.map(([name]) => name)).toEqual(expect.arrayContaining(['getCoManagedSharedProjectScreenAction', 'locateCoManagedSharedTaskAction', 'editCoManagedProjectTaskAction']));
    for (const [name, action] of actions) {
      await expect(Promise.resolve((action as any)('c', 'r', 'x', {})), name).rejects.toBeInstanceOf(Error);
    }
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(browserActor).not.toHaveBeenCalled();
  });
});
