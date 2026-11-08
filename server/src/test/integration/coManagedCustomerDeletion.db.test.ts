/**
 * L7a on real Postgres (A5 data path): deleting a co_managed CUSTOMER returns the sponsor's seat,
 * idempotently, through the same access-ending path as a departure.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeCoManagedRelationship, releaseCoManagedSeatsForCustomerDeletion } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();

describeDb('co-managed customer-side deletion releases the sponsor seat', { shuffle: false }, () => {
  let db: Knex;
  beforeAll(async () => { process.env.FORCE_CAPABILITIES = 'co-managed:on'; db = await createTestDbConnection({ databaseName: 'l7a_customer_deletion_test' }); }, 300_000);
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });

  const allocation = (f: { msp: string; relationshipId: string }) => db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).first();

  it('releases the allocation and ends the relationship, once, however often it is replayed', async () => {
    const f = await seedBoundaryFixture(db);
    expect(await allocation(f)).toMatchObject({ state: 'active' });
    expect(await releaseCoManagedSeatsForCustomerDeletion(db, f.customer)).toEqual({ released: f.seats, relationships: 1 });
    expect(await allocation(f)).toMatchObject({ state: 'released' });
    expect(await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).first()).toMatchObject({ state: 'terminated' });
    // Replay (workflow retry): nothing left to end, nothing released twice.
    expect(await releaseCoManagedSeatsForCustomerDeletion(db, f.customer)).toEqual({ released: 0, relationships: 0 });
    expect(await allocation(f)).toMatchObject({ state: 'released' });
  });

  it('a customer that already departed releases nothing more', async () => {
    const f = await seedBoundaryFixture(db);
    await closeCoManagedRelationship(db, f.mspAdmin, { customerTenant: f.customer, relationshipId: f.relationshipId },
      { operationId: randomUUID(), expectedRevision: 1, reason: 'departure' }, async () => {});
    expect(await releaseCoManagedSeatsForCustomerDeletion(db, f.customer)).toEqual({ released: 0, relationships: 0 });
  });

  it('a tenant with no relationships is a no-op', async () => {
    const f = await seedBoundaryFixture(db);
    expect(await releaseCoManagedSeatsForCustomerDeletion(db, f.msp)).toEqual({ released: 0, relationships: 0 });
    expect(await allocation(f)).toMatchObject({ state: 'active' });
  });
});
