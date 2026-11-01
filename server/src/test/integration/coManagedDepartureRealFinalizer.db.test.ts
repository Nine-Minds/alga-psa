/**
 * L7a on real Postgres: departure with the REAL archive finalizer (not the noEvidence stub).
 * Regression: comment discovery joined project_task_comments.actor_reference_id, a column no migration creates,
 * so every departure failed with `column c.actor_reference_id does not exist`.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeCoManagedRelationship, departCoManagedRelationship, finalizeCoManagedArchive } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();

describeDb('co-managed departure with the real archive finalizer', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture; const operationId = randomUUID();

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_real_finalizer_test' });
    f = await seedBoundaryFixture(db); // disposable sponsor/customer pair
  }, 300_000);
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });

  const qualified = () => ({ side: 'sponsor' as const, customerTenant: f.customer, relationshipId: f.relationshipId, sponsorTenant: f.msp });
  const departure = () => ({ operationId, expectedRevision: 1, relationshipId: f.relationshipId });
  const counts = async () => ({
    closures: await db('co_managed_relationship_closures').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first(),
    manifests: await db('co_managed_archive_manifests').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first(),
  });

  it('departure succeeds, releases the allocation once and seals the manifest', async () => {
    const receipt = await departCoManagedRelationship(db, f.mspAdmin, departure(), qualified());
    expect(receipt).toMatchObject({ relationshipId: f.relationshipId, releasedSeats: f.seats });
    expect(await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }))
      .toEqual([expect.objectContaining({ state: 'released' })]);
    expect(await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).first())
      .toMatchObject({ state: 'terminated' });
    expect(await counts()).toMatchObject({ closures: { n: '1' }, manifests: { n: '1' } });
    const manifest = await db('co_managed_archive_manifests').where({ tenant: f.msp, relationship_id: f.relationshipId }).first();
    expect(JSON.stringify(manifest)).toMatch(/seal/i);
  });

  it('a replay is idempotent', async () => {
    const again = await departCoManagedRelationship(db, f.mspAdmin, departure(), qualified());
    expect(again.releasedSeats).toBe(f.seats);
    expect(await counts()).toMatchObject({ closures: { n: '1' }, manifests: { n: '1' } });
    expect(await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId })).toHaveLength(1);
  });

  it('closeCoManagedRelationship with the real finalizer is idempotent on a second disposable pair', async () => {
    const g = await seedBoundaryFixture(db);
    const target = { customerTenant: g.customer, relationshipId: g.relationshipId };
    const req = { operationId: randomUUID(), expectedRevision: 1, reason: 'departure' as const };
    const first = await closeCoManagedRelationship(db, g.mspAdmin, target, req, finalizeCoManagedArchive);
    const second = await closeCoManagedRelationship(db, g.mspAdmin, target, req, finalizeCoManagedArchive);
    expect(second).toEqual(first);
    expect(first.releasedSeats).toBe(g.seats);
    expect(await db('co_managed_archive_manifests').where({ tenant: g.msp, relationship_id: g.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
  });
});
