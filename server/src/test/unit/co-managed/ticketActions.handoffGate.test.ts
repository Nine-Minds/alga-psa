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
const engine = vi.hoisted(() => ({ escalate: vi.fn(), handBack: vi.fn(), revoke: vi.fn() }));
const errors = vi.hoisted(() => {
  class HandoffError extends Error { constructor(public readonly code: string) { super(code); } }
  class SharedWorkError extends Error {}
  class LifecycleError extends Error {}
  return { HandoffError, SharedWorkError, LifecycleError };
});
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
  revokeCoManagedTicketGrant: engine.revoke,
  CoManagedSharedWorkError: errors.SharedWorkError,
  CoManagedTicketHandoffError: errors.HandoffError,
  isCoManagedSharedWorkError: (e: unknown) => e instanceof errors.SharedWorkError,
}, { get: (t: any, name) => name === 'then' ? undefined : (t[name] ?? vi.fn()) }));
vi.mock('@alga-psa/licensing/lifecycle', () => ({ isCoManagedLifecycleError: (e: unknown) => e instanceof errors.LifecycleError }));
vi.mock('../../../lib/co-managed/browserActor', () => ({ coManagedBrowserActor: async (_u: any, tenant: string) => ({ kind: 'session', tenant, userId: 'u', sessionId: 's' }) }));

import { registerCapabilityGate, registerCapabilityEligibility, registerCapabilityParticipation } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { escalateSharedTicketAction, handBackSharedTicketAction, revokeSharedTicketGrantAction } from '@/lib/actions/coManagedSharedWorkActions';

const request = { operationId: '11111111-1111-4111-8111-111111111111', expectedRevision: 0, note: 'n' };
const resource = { tenant: CUSTOMER, relationshipId: 'r', kind: 'ticket', id: 't' } as any;
// Refusals are returned, not thrown: production builds redact thrown server-action errors.
const refused = (code: string) => ({ ok: false, code });

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
    await expect((escalateSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: true, receipt: { ok: 'escalated' } });
    expect(engine.escalate).toHaveBeenCalledTimes(1);
  });

  it('customer take-back succeeds with the flag on and no customer entitlement', async () => {
    session.tenant = CUSTOMER;
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: true, receipt: { ok: 'handed_back' } });
    expect(engine.handBack).toHaveBeenCalledTimes(1);
  });

  it('sponsor hand-back still requires admits: refused without an entitlement, allowed with one', async () => {
    session.tenant = SPONSOR;
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual(refused('CAPABILITY_UNAVAILABLE'));
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(engine.handBack).not.toHaveBeenCalled();
    registerCapabilityEligibility('co-managed', async () => true);
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual({ ok: true, receipt: { ok: 'handed_back' } });
  });

  it('a sponsor-side session cannot escalate even when entitled', async () => {
    session.tenant = SPONSOR;
    registerCapabilityEligibility('co-managed', async () => true);
    await expect((escalateSharedTicketAction as any)(resource, request)).resolves.toEqual(refused('CAPABILITY_UNAVAILABLE'));
    expect(engine.escalate).not.toHaveBeenCalled();
  });

  it('the customer side is refused when it does not participate (serves, not the flag)', async () => {
    session.tenant = CUSTOMER;
    registerCapabilityParticipation('co-managed', async () => []);
    await expect((escalateSharedTicketAction as any)(resource, request)).resolves.toEqual(refused('CAPABILITY_UNAVAILABLE'));
    expect(engine.escalate).not.toHaveBeenCalled();
  });

  it.each([['customer', CUSTOMER], ['sponsor', SPONSOR]])('FORCE_CAPABILITIES=co-managed:off refuses %s before any read or write', async (_label, tenant) => {
    process.env.FORCE_CAPABILITIES = 'co-managed:off';
    session.tenant = tenant;
    registerCapabilityEligibility('co-managed', async () => true);
    for (const action of [escalateSharedTicketAction, handBackSharedTicketAction]) {
      await expect((action as any)(resource, request)).resolves.toEqual(refused('CAPABILITY_UNAVAILABLE'));
    }
    expect(createTenantKnex).not.toHaveBeenCalled();
    expect(engine.escalate).not.toHaveBeenCalled();
    expect(engine.handBack).not.toHaveBeenCalled();
  });

  it.each(['HANDOFF_CHANGED', 'ALREADY_RESPONSIBLE', 'ALREADY_REVOKED', 'INVALID_HANDOFF', 'DESTINATION_UNAVAILABLE'])(
    'engine refusal %s reaches the caller as a value on every command', async (code) => {
      session.tenant = CUSTOMER;
      for (const fn of [engine.escalate, engine.handBack, engine.revoke]) fn.mockRejectedValue(new errors.HandoffError(code));
      for (const action of [escalateSharedTicketAction, handBackSharedTicketAction, revokeSharedTicketGrantAction]) {
        await expect((action as any)(resource, request)).resolves.toEqual(refused(code));
      }
    });

  it('an unshared ticket answers NOT_AVAILABLE and a lapsed lifecycle answers READ_ONLY', async () => {
    session.tenant = CUSTOMER;
    engine.handBack.mockRejectedValueOnce(new errors.SharedWorkError('opaque'));
    await expect((handBackSharedTicketAction as any)(resource, request)).resolves.toEqual(refused('NOT_AVAILABLE'));
    engine.escalate.mockRejectedValueOnce(new errors.LifecycleError('read only'));
    await expect((escalateSharedTicketAction as any)(resource, request)).resolves.toEqual(refused('READ_ONLY'));
  });

  it('an unexpected failure is still thrown (its outcome is unknown; the same operationId retries safely)', async () => {
    session.tenant = CUSTOMER;
    engine.escalate.mockRejectedValueOnce(new Error('connection reset'));
    await expect((escalateSharedTicketAction as any)(resource, request)).rejects.toThrow('connection reset');
  });
});
