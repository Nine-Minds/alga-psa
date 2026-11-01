import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

const state = vi.hoisted(() => ({ perms: new Set<string>() }));
vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (db: any, tenant: string) => fake.fakeTenantDb(db, tenant), tenantTableMetadata: {},
    withTransaction: (db: any, work: any) => db.transaction(work) };
});
vi.mock('@alga-psa/licensing/lifecycle', () => ({ getCoManagedOperationalState: async () => ({}), CoManagedLifecycleError: class extends Error {} }));
vi.mock('../participationEvidence', () => ({ retainCoManagedBeforeAccessReduction: async () => undefined }));
vi.mock('../localPermission', () => ({ hasCoManagedLocalPermission: async (_db: any, _actor: any, resource: string, action: string) => state.perms.has(`${resource}:${action}`) }));

import { CoManagedPolicyError, listCoManagedLiveCustomerRelationships, listCoManagedLiveSponsoredRelationships } from '../policy';

const CUSTOMER = '11111111-1111-4111-8111-111111111111';
const SPONSOR = '22222222-2222-4222-8222-222222222222';
const SPONSOR2 = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const actor = { tenant: CUSTOMER, userId: USER } as any;

function seed() {
  const { store, db } = createFake();
  store.seed('tenants', { tenant: CUSTOMER, product_code: 'co_managed', suspended_at: null, client_name: 'Oz' },
    { tenant: SPONSOR, product_code: 'psa', suspended_at: null, client_name: 'Beta MSP' },
    { tenant: SPONSOR2, product_code: 'psa', suspended_at: null, client_name: 'Alpha MSP' });
  store.seed('co_management_relationships',
    { tenant: CUSTOMER, relationship_id: 'r-live', sponsor_tenant: SPONSOR, state: 'active', ended_at: null },
    { tenant: CUSTOMER, relationship_id: 'r-ended', sponsor_tenant: SPONSOR2, state: 'active', ended_at: '2026-01-01' },
    { tenant: CUSTOMER, relationship_id: 'r-paused', sponsor_tenant: SPONSOR2, state: 'ended', ended_at: null });
  return { store, db };
}
beforeEach(() => { state.perms = new Set(); });

describe('listCoManagedLiveCustomerRelationships', () => {
  it('refuses a user without co_management read/manage, before reading any relationship or sponsor row', async () => {
    const { store, db } = seed();
    const touched: string[] = [];
    const rows = store.rows.bind(store);
    store.rows = (table: string) => { touched.push(table); return rows(table); };
    await expect(listCoManagedLiveCustomerRelationships(db, actor)).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    expect(touched).toEqual([]);
  });

  it('with read returns exactly the live sponsor relationship with its sponsor name', async () => {
    state.perms.add('co_management:read');
    const { db } = seed();
    expect(await listCoManagedLiveCustomerRelationships(db, actor)).toEqual([{ relationshipId: 'r-live', sponsorTenant: SPONSOR, name: 'Beta MSP' }]);
  });

  it('with manage but not read also passes', async () => {
    state.perms.add('co_management:manage');
    const { db } = seed();
    expect((await listCoManagedLiveCustomerRelationships(db, actor)).map(r => r.relationshipId)).toEqual(['r-live']);
  });

  it('never lists ended relationships (ended_at set, or state not active)', async () => {
    state.perms.add('co_management:read');
    const { db } = seed();
    const ids = (await listCoManagedLiveCustomerRelationships(db, actor)).map(r => r.relationshipId);
    expect(ids).not.toContain('r-ended');
    expect(ids).not.toContain('r-paused');
  });

  it('rejects non-UUID actors before opening a transaction', async () => {
    const { db } = seed();
    await expect(listCoManagedLiveCustomerRelationships(db, { tenant: 'x', userId: USER } as any)).rejects.toMatchObject({ code: 'INVALID_POLICY' });
  });
});

describe('sponsor path regression', () => {
  it('still gates on co_management read and lists the live sponsored relationship', async () => {
    const { store, db } = createFake();
    store.seed('tenants', { tenant: SPONSOR, product_code: 'psa', suspended_at: null }, { tenant: CUSTOMER, product_code: 'co_managed', suspended_at: null, client_name: 'Oz' });
    store.seed('co_managed_provisioning_operations', { tenant: SPONSOR, operation_id: 'o1', relationship_id: 'r1', customer_tenant: CUSTOMER });
    store.seed('co_management_relationships', { tenant: CUSTOMER, relationship_id: 'r1', sponsor_tenant: SPONSOR, state: 'active', ended_at: null });
    const sponsorActor = { tenant: SPONSOR, userId: USER } as any;
    await expect(listCoManagedLiveSponsoredRelationships(db, sponsorActor)).rejects.toBeInstanceOf(CoManagedPolicyError);
    state.perms.add('co_management:read');
    expect(await listCoManagedLiveSponsoredRelationships(db, sponsorActor)).toEqual([{ relationshipId: 'r1', customerTenant: CUSTOMER, name: 'Oz' }]);
  });
});
