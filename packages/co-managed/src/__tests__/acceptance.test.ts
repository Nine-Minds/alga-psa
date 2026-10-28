import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, type FakeStore } from './fakeCoManagedDb';

const state = vi.hoisted(() => ({ invalidated: [] as string[], permitted: true }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/db/models/user', () => ({ default: { findInternalEmailClaim: async () => null } }));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: async () => state.permitted }));
vi.mock('@alga-psa/licensing', () => ({
  getCoManagedEntitlementState: async () => ({ capacity: 5, allocated: 1, isReadOnly: false, graceEndsAt: null }),
  countCoManagedCommittedSeats: async () => 1,
  invalidateCoManagedAwaitingAcceptance: (tenant: string) => { state.invalidated.push(tenant); },
  reserveCoManagedWorkspace: async () => { throw new Error('not used'); },
}));

import { acceptCoManagedRelationship, declineCoManagedRelationship, getCoManagedAcceptanceState, CoManagedAcceptanceError } from '../acceptance';

const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';
const ADMIN = '00000000-0000-4000-8000-0000000000c2';
const OTHER = '00000000-0000-4000-8000-0000000000c3';
const REL = '00000000-0000-4000-8000-0000000000d1';
const OP = '00000000-0000-4000-8000-0000000000b1';
const ESC = '00000000-0000-4000-8000-0000000000a4';
const BOARD = '00000000-0000-4000-8000-0000000000e1';
const actor = { tenant: CUSTOMER, userId: ADMIN };

function setup() {
  const { store, db } = createFake();
  store.seed('tenants', { tenant: SPONSOR, product_code: 'psa', plan: 'pro', client_name: 'Oz MSP' },
    { tenant: CUSTOMER, product_code: 'co_managed', client_name: 'Acme' });
  store.seed('co_managed_entitlements', { tenant: SPONSOR, source: 'hosted', capacity: 5 });
  store.seed('boards', { tenant: SPONSOR, board_id: ESC, board_name: 'Escalations', is_inactive: false },
    { tenant: CUSTOMER, board_id: BOARD, board_name: 'Support', is_inactive: false });
  store.seed('users', { tenant: CUSTOMER, user_id: ADMIN, user_type: 'internal', is_inactive: false });
  store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: REL, sponsor_tenant: SPONSOR,
    state: 'pending_acceptance', visibility_mode: 'board_scope', escalation_board_id: ESC, revision: 1, ended_at: null });
  store.seed('co_management_board_scopes', { tenant: CUSTOMER, relationship_id: REL, board_id: BOARD, can_collaborate: true });
  store.seed('co_managed_provisioning_operations', { tenant: SPONSOR, operation_id: OP, allocation_id: 'alloc', customer_tenant: CUSTOMER,
    relationship_id: REL, administrator_invitation_id: 'inv', state: 'pending_acceptance', step: 'administrator_invitation' });
  store.seed('co_managed_allocations', { tenant: SPONSOR, allocation_id: 'alloc', operation_id: OP, customer_tenant: CUSTOMER,
    relationship_id: REL, seats: 2, state: 'reserved' });
  store.seed('user_invitations', { tenant: CUSTOMER, invitation_id: 'inv', used_at: null });
  db.__store = store;
  return { store, db: db as any };
}
async function review(db: any) {
  const review = await getCoManagedAcceptanceState(db, actor);
  if (review.state !== 'pending_acceptance') throw new Error(`unexpected ${review.state}`);
  return { relationshipId: review.relationshipId, revision: review.revision, scopeFingerprint: review.scopeFingerprint };
}
const rel = (store: FakeStore) => store.rows('co_management_relationships')[0];
const events = (store: FakeStore, type: string) => store.rows('co_management_relationship_events').filter(e => e.event_type === type);
const expectCode = (promise: Promise<unknown>, code: string) =>
  expect(promise).rejects.toSatisfy((e: any) => e instanceof CoManagedAcceptanceError && e.code === code);

describe('co-managed acceptance', () => {
  beforeEach(() => { state.invalidated = []; state.permitted = true; });

  it('accepts a matching revision and fingerprint, activates the seats and retries as a no-op', async () => {
    const { store, db } = setup();
    const input = await review(db);
    await acceptCoManagedRelationship(db, actor, input);
    expect(rel(store)).toMatchObject({ state: 'active', revision: 2, accepted_by: ADMIN });
    expect(store.rows('co_managed_allocations')[0].state).toBe('active');
    expect(events(store, 'accepted')).toHaveLength(1);
    expect(state.invalidated).toEqual([CUSTOMER]);
    await acceptCoManagedRelationship(db, actor, input);
    expect(events(store, 'accepted')).toHaveLength(1);
  });

  it('refuses a stale revision', async () => {
    const { store, db } = setup();
    const input = await review(db);
    rel(store).revision = 2;
    await expectCode(acceptCoManagedRelationship(db, actor, input), 'SCOPE_CHANGED');
    expect(rel(store).state).toBe('pending_acceptance');
    expect(state.invalidated).toEqual([]);
  });

  it('refuses a changed scope fingerprint, including after a board is added to the proposal', async () => {
    const { store, db } = setup();
    const input = await review(db);
    await expectCode(acceptCoManagedRelationship(db, actor, { ...input, scopeFingerprint: 'f'.repeat(64) }), 'SCOPE_CHANGED');
    store.seed('boards', { tenant: CUSTOMER, board_id: OTHER, board_name: 'Billing', is_inactive: false });
    store.seed('co_management_board_scopes', { tenant: CUSTOMER, relationship_id: REL, board_id: OTHER, can_collaborate: false });
    await expectCode(acceptCoManagedRelationship(db, actor, input), 'SCOPE_CHANGED');
    expect(rel(store).state).toBe('pending_acceptance');
    expect(events(store, 'accepted')).toHaveLength(0);
  });

  it('refuses malformed input and a non-administrator', async () => {
    const { store, db } = setup();
    const input = await review(db);
    await expectCode(acceptCoManagedRelationship(db, actor, { ...input, scopeFingerprint: 'nope' }), 'SCOPE_CHANGED');
    state.permitted = false;
    await expectCode(acceptCoManagedRelationship(db, actor, input), 'FORBIDDEN');
    await expectCode(declineCoManagedRelationship(db, actor, input), 'FORBIDDEN');
    // A user who is not an active internal user of the customer workspace never qualifies.
    state.permitted = true;
    await expectCode(acceptCoManagedRelationship(db, { tenant: CUSTOMER, userId: OTHER }, input), 'FORBIDDEN');
    // An MSP admin presenting its own tenant has no co_managed workspace behind it.
    store.seed('users', { tenant: SPONSOR, user_id: OTHER, user_type: 'internal', is_inactive: false });
    await expectCode(acceptCoManagedRelationship(db, { tenant: SPONSOR, userId: OTHER }, input), 'FORBIDDEN');
    expect(rel(store).state).toBe('pending_acceptance');
    expect(store.rows('co_managed_provisioning_operations')[0].state).toBe('pending_acceptance');
  });

  describe('decline', () => {
    it('records a declined receipt at revision + 1, requests cleanup and stays pending_acceptance', async () => {
      const { store, db } = setup();
      const input = await review(db);
      const result = await declineCoManagedRelationship(db, actor, input);
      expect(result).toEqual({ relationshipId: REL, operationId: OP, sponsorTenant: SPONSOR, cleanupRequested: true });
      expect(rel(store)).toMatchObject({ state: 'pending_acceptance', revision: 2 });
      expect(events(store, 'declined')).toMatchObject([{ revision: 2, actor_user_id: ADMIN, scope_fingerprint: input.scopeFingerprint }]);
      expect(store.rows('co_managed_provisioning_operations')[0].state).toBe('cleanup_requested');
      expect(store.rows('co_managed_allocations')[0].state).toBe('reserved');
      expect(state.invalidated).toEqual([CUSTOMER]);
      expect(await getCoManagedAcceptanceState(db, actor)).toEqual({ state: 'cancelled', sponsorName: 'Oz MSP' });
    });

    it('is idempotent on retry and cannot be followed by an accept', async () => {
      const { store, db } = setup();
      const input = await review(db);
      await declineCoManagedRelationship(db, actor, input);
      const again = await declineCoManagedRelationship(db, actor, input);
      expect(again.cleanupRequested).toBe(true);
      expect(events(store, 'declined')).toHaveLength(1);
      expect(rel(store).revision).toBe(2);
      await expectCode(acceptCoManagedRelationship(db, actor, input), 'NOT_PENDING');
    });

    it('refuses a stale revision or changed fingerprint and writes nothing', async () => {
      const { store, db } = setup();
      const input = await review(db);
      await expectCode(declineCoManagedRelationship(db, actor, { ...input, scopeFingerprint: 'a'.repeat(64) }), 'SCOPE_CHANGED');
      await expectCode(declineCoManagedRelationship(db, actor, { ...input, revision: 5 }), 'SCOPE_CHANGED');
      expect(events(store, 'declined')).toHaveLength(0);
      expect(store.rows('co_managed_provisioning_operations')[0].state).toBe('pending_acceptance');
      expect(state.invalidated).toEqual([]);
    });

    it('rolls back the receipt when cleanup is not eligible (an activated relationship elsewhere)', async () => {
      const { store, db } = setup();
      const input = await review(db);
      store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: OTHER, sponsor_tenant: SPONSOR, state: 'active', revision: 2, ended_at: null });
      await expect(declineCoManagedRelationship(db, actor, input)).rejects.toMatchObject({ code: 'RESERVATION_NOT_FOUND' });
      expect(events(store, 'declined')).toHaveLength(0);
      expect(rel(store).revision).toBe(1);
    });
  });
});
