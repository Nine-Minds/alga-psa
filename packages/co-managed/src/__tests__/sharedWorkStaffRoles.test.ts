import { describe, expect, it, vi } from 'vitest';
import { createFake } from './fakeCoManagedDb';

vi.mock('@alga-psa/db', async () => {
  const fake = await import('./fakeCoManagedDb');
  return { tenantDb: (_db: any, tenant: string) => fake.fakeTenantDb(_db, tenant) };
});

import { loadCoManagedStaffRoles } from '../sharedWork';

const SPONSOR = 'sponsor-tenant';
const CUSTOMER = 'customer-tenant';
const RELATIONSHIP = 'relationship-1';
const ACTOR = 'user-1';
const TEAM = 'team-1';

describe('loadCoManagedStaffRoles', () => {
  it('matches direct user assignments OR team assignments while requiring the same customer and relationship', async () => {
    const { store, db } = createFake();
    store.seed('co_management_staff_assignments',
      { tenant: SPONSOR, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, principal_type: 'user', principal_id: ACTOR, relationship_role: 'direct' },
      { tenant: SPONSOR, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, principal_type: 'team', principal_id: TEAM, relationship_role: 'team' },
      { tenant: SPONSOR, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, principal_type: 'team', principal_id: 'other-team', relationship_role: 'other-team' },
      { tenant: SPONSOR, customer_tenant: CUSTOMER, relationship_id: 'other-relationship', principal_type: 'team', principal_id: TEAM, relationship_role: 'other-relationship' },
      { tenant: SPONSOR, customer_tenant: 'other-customer', relationship_id: RELATIONSHIP, principal_type: 'user', principal_id: ACTOR, relationship_role: 'other-customer' },
      { tenant: SPONSOR, customer_tenant: CUSTOMER, relationship_id: RELATIONSHIP, principal_type: 'user', principal_id: 'other-user', relationship_role: 'other-user' },
    );

    const roles = await loadCoManagedStaffRoles(db, { tenant: SPONSOR, userId: ACTOR }, CUSTOMER, RELATIONSHIP, [TEAM]);

    expect(roles.sort()).toEqual(['direct', 'team']);
  });
});
