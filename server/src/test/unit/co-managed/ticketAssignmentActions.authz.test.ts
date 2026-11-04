import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * listSharedTicketAssigneesAction exposes the sponsor's staff directory, so it is gated by the same
 * predicate as assignment (`admits`), not `serves`. The real capability gate is driven via mocked
 * resolvers: a tenant that serves but does not admit is refused before any actor or connection work.
 */
const gate = vi.hoisted(() => ({ serves: true, admits: false, checked: [] as string[] }));
const createTenantKnex = vi.fn(), browserActor = vi.fn(), listAssignees = vi.fn();
vi.mock('@alga-psa/core/capability/server', () => ({
  CapabilityUnavailableError: class extends Error {},
  requireCapabilityForAction: async (_c: string, _t: string, mode = 'admits') => {
    gate.checked.push(mode);
    if (!gate[mode as 'serves' | 'admits']) throw new Error('CAPABILITY_UNAVAILABLE');
  },
}));
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'client' }, { tenant: 't' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a) }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ isCoManagedLifecycleError: () => false }));
vi.mock('@alga-psa/co-managed', () => ({
  listCoManagedTicketAssignees: (...a: any[]) => listAssignees(...a), getCoManagedTicketAssignment: vi.fn(), assignCoManagedTicket: vi.fn(),
  CoManagedTicketAssignmentError: class extends Error {}, CoManagedSharedWorkError: class extends Error {},
}));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));

const resource = { kind: 'ticket', tenant: 't', relationshipId: 'r', id: 'x' };

describe('listSharedTicketAssigneesAction gate', () => {
  beforeEach(() => { gate.serves = true; gate.admits = false; gate.checked = []; createTenantKnex.mockClear(); browserActor.mockClear(); listAssignees.mockReset(); });

  it('refuses a caller that serves but does not admit, and never lists candidates', async () => {
    const { listSharedTicketAssigneesAction } = await import('@/lib/actions/coManagedTicketAssignmentActions');
    await expect((listSharedTicketAssigneesAction as any)(resource, 'user')).rejects.toThrow('CAPABILITY_UNAVAILABLE');
    expect(gate.checked).toEqual(['admits']);
    expect(listAssignees).not.toHaveBeenCalled(); expect(createTenantKnex).not.toHaveBeenCalled(); expect(browserActor).not.toHaveBeenCalled();
  });

  it('proceeds when the tenant admits', async () => {
    gate.admits = true; browserActor.mockResolvedValue({ a: 1 }); createTenantKnex.mockResolvedValue({ knex: 'k' }); listAssignees.mockResolvedValue({ options: [], nextAfterId: null });
    const { listSharedTicketAssigneesAction } = await import('@/lib/actions/coManagedTicketAssignmentActions');
    await expect((listSharedTicketAssigneesAction as any)(resource, 'user')).resolves.toEqual({ options: [], nextAfterId: null });
    expect(listAssignees).toHaveBeenCalledOnce();
  });
});
