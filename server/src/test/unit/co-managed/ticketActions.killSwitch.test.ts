import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * L3b1 A7 kill switch. With FORCE_CAPABILITIES=co-managed:off (the real gate, not a mock) every
 * action this card adds refuses before it resolves an actor or opens a connection, so a closed
 * capability costs a psa tenant no query. Every exported action is enumerated, so a new action
 * added without a gate fails here.
 */
const createTenantKnex = vi.fn();
const browserActor = vi.fn();
vi.mock('@alga-psa/auth', () => ({ withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: 't' }, ...args) }));
vi.mock('@alga-psa/db', () => ({ createTenantKnex: (...a: any[]) => createTenantKnex(...a), tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/co-managed', async () => new Proxy({}, { get: (_t, name) => name === 'then' ? undefined : vi.fn() }));
vi.mock('@alga-psa/tickets/actions/optimizedTicketActions', () => ({ updateTicketInTransaction: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/validateTicketClosure', () => ({ TicketCloseValidationError: class extends Error {} }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ CoManagedLifecycleError: class extends Error {}, isCoManagedLifecycleError: () => false }));
vi.mock('@/lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: (...a: any[]) => browserActor(...a) }));
vi.mock('../../../lib/utils/csvParser', () => ({ unparseCSV: vi.fn() }));

const modules = {
  work: () => import('@/lib/actions/coManagedSharedWorkActions'),
  assignment: () => import('@/lib/actions/coManagedTicketAssignmentActions'),
  edit: () => import('@/lib/actions/coManagedTicketEditActions'),
  queue: () => import('@/lib/actions/coManagedTicketQueueActions'),
};

describe('L3b1 actions under FORCE_CAPABILITIES=co-managed:off', () => {
  beforeEach(() => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    createTenantKnex.mockClear(); browserActor.mockClear();
  });

  for (const [label, load] of Object.entries(modules)) {
    it(`${label}: every action refuses and touches no database`, async () => {
      const mod = await load();
      const actions = Object.entries(mod).filter(([, value]) => typeof value === 'function');
      expect(actions.length).toBeGreaterThan(0);
      for (const [name, action] of actions) {
        // Handoff commands return their refusal (production redacts thrown action errors); everything else throws.
        const outcome = await Promise.resolve((action as any)({ tenant: 't', relationshipId: 'r', kind: 'ticket', id: 'x' }, {}))
          .then(value => ({ value }), error => ({ error }));
        if ('value' in outcome) expect(outcome.value, name).toEqual({ ok: false, code: 'CAPABILITY_UNAVAILABLE' });
        else expect(outcome.error, name).toBeInstanceOf(Error);
      }
      expect(createTenantKnex).not.toHaveBeenCalled();
      expect(browserActor).not.toHaveBeenCalled();
    });
  }

  it('a malformed override also closes the gate', async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:maybe';
    const mod = await modules.queue();
    await expect((mod.getCoManagedTicketQueueAction as any)({ view: 'working' })).rejects.toThrow();
    expect(createTenantKnex).not.toHaveBeenCalled();
  });
});
