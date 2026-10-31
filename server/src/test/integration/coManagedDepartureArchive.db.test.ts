/**
 * L7a on real Postgres (A1, A2): relationship closure releases exactly once; replay is idempotent;
 * an unauthorized party is refused; the sealed MSP archive holds retained participation evidence only.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeCoManagedRelationship, CoManagedClosureError, getCoManagedArchiveHistory, getCoManagedDepartureScreen,
  listCoManagedArchives, readCoManagedArchiveFile, registerCoManagedArchiveFileSource } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();

describeDb('co-managed closure and archive on real Postgres', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture; const operationId = randomUUID(); const fileId = randomUUID();
  const noEvidence = async () => {};
  const target = () => ({ customerTenant: f.customer, relationshipId: f.relationshipId });
  const request = (extra: object = {}) => ({ operationId, expectedRevision: 1, reason: 'departure' as const, ...extra });
  let unregister: () => void;

  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_closure_archive_test' });
    f = await seedBoundaryFixture(db);
    unregister = registerCoManagedArchiveFileSource({ name: 'test', list: async () => [{ id: fileId, hash: 'a'.repeat(64), size: 5 }] });
  }, 300_000);
  afterAll(async () => { unregister?.(); delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });

  it('A1: an unauthorized party is refused and nothing is released', async () => {
    await expect(closeCoManagedRelationship(db, f.stranger, target(), request(), noEvidence)).rejects.toThrow();
    expect(await db('co_managed_relationship_closures').where({ tenant: f.msp }).count('* as n').first()).toMatchObject({ n: '0' });
    expect(await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).first('state')).toMatchObject({ state: 'active' });
  });

  it('A1: the review warns about seats and does not block', async () => {
    const review = await getCoManagedDepartureScreen(db, f.mspAdmin, undefined,
      { side: 'sponsor', customerTenant: f.customer, relationshipId: f.relationshipId, sponsorTenant: f.msp });
    expect(review).toMatchObject({ departed: false, seatsToRelease: 3, revision: 1 });
  });

  it('A1: allocate then close releases the seats exactly once', async () => {
    const receipt = await closeCoManagedRelationship(db, f.mspAdmin, target(), request(), noEvidence);
    expect(receipt).toMatchObject({ releasedSeats: f.seats, relationshipId: f.relationshipId });
    const allocation = await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).first();
    expect(allocation).toMatchObject({ state: 'released' });
    expect(allocation.released_at).toBeTruthy();
    const relationship = await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).first();
    expect(relationship).toMatchObject({ state: 'terminated' });
    expect(relationship.ended_at).toBeTruthy();
  });

  it('A1: replay yields one closure row, no second release and the same receipt', async () => {
    const again = await closeCoManagedRelationship(db, f.mspAdmin, target(), request(), noEvidence);
    expect(again.releasedSeats).toBe(f.seats);
    expect(await db('co_managed_relationship_closures').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
    expect(await db('co_managed_archive_manifests').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
  });

  it('A1: the same operation with different input is a conflict, and a different operation on a closed relationship is refused', async () => {
    await expect(closeCoManagedRelationship(db, f.mspAdmin, target(), request({ expectedRevision: 7 }), noEvidence))
      .rejects.toMatchObject({ code: 'CLOSURE_CHANGED' });
    await expect(closeCoManagedRelationship(db, f.mspAdmin, target(), request({ operationId: randomUUID() }), noEvidence))
      .rejects.toBeInstanceOf(CoManagedClosureError);
  });

  it('A2: the archive keeps retained evidence and omits customer-private and post-cutoff content', async () => {
    const list = await listCoManagedArchives(db, f.mspAdmin);
    expect(list.items).toHaveLength(1);
    const history = await getCoManagedArchiveHistory(db, f.mspAdmin, operationId);
    const ids = history.entries.map(entry => entry.id);
    for (const kept of ['sharedMessage', 'requesterMessage', 'privateMessage', 'audit'] as const) expect(ids).toContain(f.evidence[kept]);
    for (const dropped of ['customerPrivate', 'afterCutoff', 'customerOrgPrivate', 'customerPrivateAsPrivateConversation'] as const) expect(ids).not.toContain(f.evidence[dropped]);
    const text = JSON.stringify(history);
    expect(text).not.toContain('CUSTOMER-PRIVATE SECRET');
    expect(text).not.toContain('POST-CUTOFF SECRET');
    expect(text).not.toContain('CUSTOMER-ORG-PRIVATE SECRET');
    expect(text).not.toContain('CUSTOMER-AS-PRIVATE-CONVERSATION SECRET');
    expect(history.exclusions).toEqual(expect.arrayContaining([
      { evidenceClass: 'conversation', reason: 'audience_not_allowlisted', count: 2 },
      { evidenceClass: 'private_conversation', reason: 'audience_not_allowlisted', count: 1 },
      { evidenceClass: 'conversation', reason: 'after_cutoff', count: 1 }]));
    expect(history.files.map(file => file.archiveFileId)).toEqual([fileId]);
  });

  it('A2: evidence guessed by id outside the sealed manifest is unreachable, and an unsourced file id is a 404', async () => {
    const history = await getCoManagedArchiveHistory(db, f.mspAdmin, operationId, 0);
    expect(history.entries.every(entry => entry.id !== f.evidence.customerPrivate)).toBe(true);
    expect(await readCoManagedArchiveFile(db, f.mspAdmin, randomUUID())).toBeNull();
    expect(await readCoManagedArchiveFile(db, f.mspAdmin, fileId)).toBeNull(); // the test source has no `open`
  });

  it('A2: a reader without co_management:read gets nothing', async () => {
    await expect(listCoManagedArchives(db, f.stranger)).rejects.toThrow();
  });
});
