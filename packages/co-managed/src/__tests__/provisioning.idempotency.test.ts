import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake, fakeTenantDb } from './fakeCoManagedDb';

const state = vi.hoisted(() => ({ reserveCalls: 0, invalidated: [] as string[] }));

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/db/models/user', () => ({ default: { findInternalEmailClaim: async () => null } }));
vi.mock('@alga-psa/licensing', async () => {
  const fake = await import('./fakeCoManagedDb');
  return {
    getCoManagedEntitlementState: async () => ({ capacity: 5, allocated: 1, isReadOnly: false, graceEndsAt: null }),
    invalidateCoManagedAwaitingAcceptance: (tenant: string) => { state.invalidated.push(tenant); },
    /** Faithful to the real reservation's idempotency record: unique (sponsor, operation_id). */
    reserveCoManagedWorkspace: async (trx: any, input: any) => {
      state.reserveCalls += 1;
      const sponsor = fake.fakeTenantDb(trx, input.sponsorTenant);
      const existing = await sponsor.table('co_managed_allocations').where('operation_id', input.operationId).first();
      if (existing) return { ...existing, state: existing.state };
      const reservation = { allocation_id: `a-${input.operationId}`, customer_tenant: '00000000-0000-4000-8000-0000000000c1',
        relationship_id: '00000000-0000-4000-8000-0000000000d1' };
      await sponsor.table('co_managed_allocations').insert({ tenant: input.sponsorTenant, operation_id: input.operationId,
        allocation_id: reservation.allocation_id, customer_tenant: reservation.customer_tenant,
        relationship_id: reservation.relationship_id, seats: input.seats, state: 'reserved' });
      await fake.fakeTenantDb(trx, reservation.customer_tenant).table('co_management_relationships').insert({
        tenant: reservation.customer_tenant, relationship_id: reservation.relationship_id, sponsor_tenant: input.sponsorTenant,
        sponsor_client_id: input.clientId, state: 'provisioning', visibility_mode: input.visibilityMode, revision: 1, ended_at: null });
      return { ...reservation, state: 'reserved' };
    },
  };
});

import { prepareCoManagedProvisioning, runCoManagedProvisioningStep, finalizeCoManagedProvisioning,
  CoManagedProvisioningError, type CoManagedProvisioningRequest } from '../provisioning';

const SPONSOR = '00000000-0000-4000-8000-0000000000a1';
const USER = '00000000-0000-4000-8000-0000000000a2';
const CLIENT = '00000000-0000-4000-8000-0000000000a3';
const BOARD = '00000000-0000-4000-8000-0000000000a4';
const OP = '00000000-0000-4000-8000-0000000000b1';
const CUSTOMER = '00000000-0000-4000-8000-0000000000c1';

const request = (over: Partial<CoManagedProvisioningRequest> = {}): CoManagedProvisioningRequest => ({
  sponsorTenant: SPONSOR, operationId: OP, requestedBy: USER, clientId: CLIENT, workspaceName: 'Acme Co-managed',
  administrator: { firstName: 'Ada', lastName: 'Admin', email: 'Ada@Acme.test' }, seats: 2, visibilityMode: 'board_scope',
  escalationBoardId: BOARD, ...over });

function setup() {
  const { store, db } = createFake();
  store.seed('tenants', { tenant: SPONSOR, product_code: 'psa', plan: 'pro', client_name: 'Oz MSP' });
  store.seed('co_managed_entitlements', { tenant: SPONSOR, source: 'hosted', capacity: 5 });
  store.seed('users', { tenant: SPONSOR, user_id: USER, user_type: 'internal', is_inactive: false });
  store.seed('boards', { tenant: SPONSOR, board_id: BOARD, board_name: 'Escalations', is_inactive: false });
  return { store, db };
}
const count = (store: any, table: string, where: Record<string, unknown> = {}) =>
  store.rows(table).filter((row: any) => Object.entries(where).every(([k, v]) => row[k] === v)).length;

describe('co-managed provisioning idempotency', () => {
  beforeEach(() => { state.reserveCalls = 0; state.invalidated = []; });

  it('the same operationId twice yields one operation, one allocation and one requested event', async () => {
    const { store, db } = setup(); db.__store = store;
    const first = await prepareCoManagedProvisioning(db, request());
    const second = await prepareCoManagedProvisioning(db, request());
    expect(second.operation_id).toBe(first.operation_id);
    expect(second.request_fingerprint).toBe(first.request_fingerprint);
    expect(count(store, 'co_managed_provisioning_operations')).toBe(1);
    expect(count(store, 'co_managed_allocations')).toBe(1);
    expect(count(store, 'co_management_relationship_events', { event_type: 'requested' })).toBe(1);
    expect(first.state).toBe('queued');
    expect(first.request.administrator.email).toBe('ada@acme.test');
  });

  it('a differing fingerprint under the same operationId is OPERATION_CONFLICT and writes nothing', async () => {
    const { store, db } = setup(); db.__store = store;
    await prepareCoManagedProvisioning(db, request());
    await expect(prepareCoManagedProvisioning(db, request({ seats: 3 }))).rejects.toMatchObject({ code: 'OPERATION_CONFLICT' });
    await expect(prepareCoManagedProvisioning(db, request({ workspaceName: 'Other' }))).rejects.toBeInstanceOf(CoManagedProvisioningError);
    expect(count(store, 'co_managed_provisioning_operations')).toBe(1);
    expect(count(store, 'co_managed_allocations')).toBe(1);
  });

  it('a step runs once: the replay is skipped and creates no second tenant row', async () => {
    const { store, db } = setup(); db.__store = store;
    await prepareCoManagedProvisioning(db, request());
    let works = 0;
    const createTenant = async (trx: any) => {
      works += 1;
      await fakeTenantDb(trx, CUSTOMER).table('tenants').insert({ tenant: CUSTOMER, product_code: 'co_managed', client_name: 'Acme Co-managed' });
    };
    expect(await runCoManagedProvisioningStep(db, SPONSOR, OP, 'tenant', createTenant)).toMatchObject({ skipped: false });
    expect(await runCoManagedProvisioningStep(db, SPONSOR, OP, 'tenant', createTenant)).toEqual({ skipped: true });
    expect(works).toBe(1);
    expect(count(store, 'tenants', { tenant: CUSTOMER })).toBe(1);
    expect(store.rows('co_managed_provisioning_operations')[0]).toMatchObject({ state: 'provisioning', step: 'tenant' });
    // A step may not skip ahead of the recorded one.
    await expect(runCoManagedProvisioningStep(db, SPONSOR, OP, 'settings', async () => undefined)).rejects.toMatchObject({ code: 'OPERATION_CLOSED' });
  });

  it('a failed step rolls back its data and its progress together', async () => {
    const { store, db } = setup(); db.__store = store;
    await prepareCoManagedProvisioning(db, request());
    await expect(runCoManagedProvisioningStep(db, SPONSOR, OP, 'tenant', async trx => {
      await fakeTenantDb(trx, CUSTOMER).table('tenants').insert({ tenant: CUSTOMER, product_code: 'co_managed' });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    expect(count(store, 'tenants', { tenant: CUSTOMER })).toBe(0);
    const [operation] = store.rows('co_managed_provisioning_operations');
    expect(operation.state).toBe('queued');
    expect(operation.step ?? null).toBeNull();
  });

  it('finalize writes one scope row and one prepared event, and a replay writes nothing', async () => {
    const { store, db } = setup(); db.__store = store;
    const op = await prepareCoManagedProvisioning(db, request());
    await runCoManagedProvisioningStep(db, SPONSOR, OP, 'tenant', async trx => {
      const customer = fakeTenantDb(trx, CUSTOMER);
      await customer.table('tenants').insert({ tenant: CUSTOMER, product_code: 'co_managed', client_name: 'Acme Co-managed' });
      await customer.table('boards').insert({ tenant: CUSTOMER, board_id: op.customer_board_id, board_name: 'Support', is_inactive: false });
    });
    await runCoManagedProvisioningStep(db, SPONSOR, OP, 'seeds', async () => undefined);
    await runCoManagedProvisioningStep(db, SPONSOR, OP, 'settings', async () => undefined);
    await runCoManagedProvisioningStep(db, SPONSOR, OP, 'administrator_invitation', async trx => {
      await fakeTenantDb(trx, CUSTOMER).table('user_invitations').insert({ tenant: CUSTOMER, invitation_id: op.administrator_invitation_id,
        email: 'ada@acme.test', used_at: null, expires_at: '2099-01-01T00:00:00.000Z' });
    });
    await finalizeCoManagedProvisioning(db, SPONSOR, OP);
    await finalizeCoManagedProvisioning(db, SPONSOR, OP);
    expect(count(store, 'co_management_board_scopes')).toBe(1);
    expect(count(store, 'co_management_relationship_events', { event_type: 'prepared', revision: 1 })).toBe(1);
    expect(store.rows('co_management_relationships')[0]).toMatchObject({ state: 'pending_acceptance', escalation_board_id: BOARD });
    expect(store.rows('co_managed_provisioning_operations')[0]).toMatchObject({ state: 'pending_acceptance' });
  });
});
