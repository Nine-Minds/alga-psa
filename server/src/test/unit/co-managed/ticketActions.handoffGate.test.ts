import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The handoff commands' gate is side-aware. The REAL capability gate decides; only the process
 * boundary (auth, db, engine) is mocked. A customer tenant never holds an entitlement, so the
 * customer side (session tenant === resource.tenant) needs `serves`, never `admits`. The sponsor
 * side still needs `admits`.
 */
const CUSTOMER = 'tenant-customer';
const SPONSOR = 'tenant-sponsor';
const session = vi.hoisted(() => ({ tenant: '' }));
const engine = vi.hoisted(() => ({ escalate: vi.fn(), handBack: vi.fn() }));
const createTenantKnex = vi.hoisted(() => vi.fn());
const flag = vi.hoisted(() => vi.fn());

vi.mock('@alga-psa/auth', () => ({
  withAuth: (fn: any) => (...args: any[]) => fn({ user_id: 'u', user_type: 'internal' }, { tenant: session.tenant }, ...args),
}));
vi.mock('@alga-psa/db', () => ({ createTenantKnex, tenantDb: vi.fn(), withTransaction: vi.fn() }));
vi.mock('@alga-psa/core/features', () => ({ isFeatureFlagEnabled: flag }));
vi.mock('@alga-psa/co-managed', async () => new Proxy({
  escalateCoManagedTicket: engine.escalate,
  handBackCoManagedTicket: engine.handBack,
  CoManagedSharedWorkError: class extends Error {},
}, { get: (t: any, name) => name === 'then' ? undefined : (t[name] ?? vi.fn()) }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ isCoManagedLifecycleError: () => false }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async (_u: any, tenant: string) => ({ kind: 'session', tenant, userId: 'u', sessionId: 's' }) }));

import { registerCapabilityGate, registerCapabilityEligibility, registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { escalateSharedTicketAction, handBackSharedTicketAction } from '@/lib/actions/coManagedSharedWorkActions';

const request = { operationId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, note: 'n' };
const resource = { tenant: CUSTOMER, relationshipId: 'r', kind: 'ticket', id: 't' } as any;

describe('side-aware handoff gate', () => {
  beforeEach(() => {
    resetCapabilityRegistry(); clearCapabilityCache();
    registerCapabilityGate({ capability: 'co-managed', featureFlag: 'co-managed-it' });
    // Flag on. Nobody holds an entitlement (the customer never does); both tenants participate in a relationship.
    flag.mockResolvedValue(true);
    registerCapabilityEligibility('co-managed', async () => false);
    registerCapabilityParticipation('co-managed', async ({ tenantIds }) => tenantIds);
    createTenantKnex.mockResolvedValue({ knex: {} });
    engine.escalate.mockResolvedValue({ ok: 'escalated' });
    engine.handBack.mockResolvedValue({ ok: 'handed_back' });
  });
  afterEach(() => { delete process.env.FORCE_CAPABILITIES; vi.clearAllMocks(); });

  it('customer escalate succeeds with the flag on and no customer entitlement', async () => {
    session.tenant = CUSTOMER;
    await expect((escalateSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: 'escalated' });
    expect(engine.escalate).toHaveBeenCalledTimes(1);
  });

  it('customer take-back succeeds with the flag on and no customer entitlement', async () => {
    session.tenant = CUSTOMER;
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: 'handed_back' });
    expect(engine.handBack).toHaveBeenCalledTimes(1);
  });

  it('sponsor hand-back still requires admits: refused without an entitlement, allowed with one', async () => {
    session.tenant = SPONSOR;
    await expect((handBackSharedTicketAction as any)(resource, request)).rejects.toThrow('not available');
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(engine.handBack).not.toHaveBeenCalled();
    registerCapabilityEligibility('co-managed', async () => true);
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: 'handed_back' });
  });

  it('a sponsor-side session cannot escalate even when entitled', async () => {
    session.tenant = SPONSOR;
    registerCapabilityEligibility('co-managed', async () => true);
    await expect((escalateSharedTicketAction as any)(resource, request)).rejects.toThrow('not available');
    expect(engine.escalate).not.toHaveBeenCalled();
  });

  it('the customer side is refused when it does not participate (serves, not the flag)', async () => {
    session.tenant = CUSTOMER;
    registerCapabilityParticipation('co-managed', async () => []);
    await expect((escalateSharedTicketAction as any)(resource, request)).rejects.toThrow('not available');
    expect(engine.escalate).not.toHaveBeenCalled();
  });

  it.each([['customer', CUSTOMER], ['sponsor', SPONSOR]])('FORCE_CAPABILITIES=co-managed:off refuses %s before any read or write', async (_label, tenant) => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    session.tenant = tenant;
    registerCapabilityEligibility('co-managed', async () => true);
    for (const action of [escalateSharedTicketAction, handBackSharedTicketAction]) {
      await expect((action as any)(resource, request)).rejects.toThrow('not available');
    }
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(engine.escalate).not.toHaveBeenCalled();
    expect(engine.handBack).not.toHaveBeenCalled();
  });
});
