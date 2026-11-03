/**
 * L7a on real Postgres (A1, A2): relationship closure releases exactly once; replay is idempotent;
 * an unauthorized party is refused; the sealed MSP archive holds retained participation evidence only.
 */
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeCoManagedRelationship, CoManagedClosureError, finalizeCoManagedArchive, getCoManagedArchiveHistory, getCoManagedDepartureScreen,
  listCoManagedArchives, readCoManagedArchiveFile, retainCoManagedTimeParticipation } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();
const { retainedBytes } = vi.hoisted(() => ({ retainedBytes: new Uint8Array(Buffer.from('actual retained file')) }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: async () => ({ download: async () => retainedBytes }) },
}));

describeDb('co-managed closure and archive on real Postgres', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture; const operationId = randomUUID(); const fileId = randomUUID();
  const finalizeArchive = finalizeCoManagedArchive;
  const target = () => ({ customerTenant: f.customer, relationshipId: f.relationshipId });
  const request = (extra: object = {}) => ({ operationId, expectedRevision: 1, reason: 'departure' as const, ...extra });
  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_closure_archive_test' });
    f = await seedBoundaryFixture(db);
    const entryId = randomUUID();
    await db('time_entries').insert({ tenant: f.msp, entry_id: entryId, user_id: f.mspAdmin.userId, work_date: new Date(Date.now() - 900_000), work_timezone: 'UTC', start_time: new Date(Date.now() - 1800_000),
      end_time: new Date(Date.now() - 900_000), work_item_type: 'co_managed', work_item_id: randomUUID(), created_at: new Date(Date.now() - 900_000) });
    await db('co_managed_time_work_references').insert({ tenant: f.msp, entry_id: entryId, customer_tenant: f.customer,
      relationship_id: f.relationshipId, source_kind: 'ticket', source_id: f.resourceId, local_reference_id: randomUUID(),
      client_id: f.sponsorClient, title: 'Shared work', ticket_number: 'L7-TIME' });
    await db.transaction(trx => retainCoManagedTimeParticipation(trx, f.msp, entryId));
    const contentHash = (await import('node:crypto')).createHash('sha256').update(retainedBytes).digest('hex');
    await db('co_management_conversation_attachments').insert({ tenant: f.customer, attachment_id: fileId, customer_tenant: f.customer,
      relationship_id: f.relationshipId, ticket_id: f.resourceId, thread_id: f.fileThreadId, comment_id: f.fileCommentId,
      actor_tenant: f.msp, actor_user_id: f.mspAdmin.userId, file_name: 'handoff.txt', mime_type: 'text/plain', file_size: retainedBytes.length,
      content_hash: contentHash, request_hash: 'b'.repeat(64), storage_path: `co-management/${f.customer}/${fileId}`, status: 'ready',
      ready_at: new Date(), draft_operation_id: null });
    const privateFileId = randomUUID();
    await db('co_management_conversation_attachments').insert({ tenant: f.customer, attachment_id: privateFileId, customer_tenant: f.customer,
      relationship_id: f.relationshipId, ticket_id: f.resourceId, thread_id: f.privateFileThreadId, comment_id: f.privateFileCommentId,
      actor_tenant: f.customer, actor_user_id: f.customerAdmin.userId, file_name: 'customer-private.txt', mime_type: 'text/plain', file_size: retainedBytes.length,
      content_hash: contentHash, request_hash: 'c'.repeat(64), storage_path: `co-management/${f.customer}/${privateFileId}`, status: 'ready',
      ready_at: new Date(), draft_operation_id: null });
  }, 300_000);
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; await db?.destroy(); });

  it('A1: an unauthorized party is refused and nothing is released', async () => {
    await expect(closeCoManagedRelationship(db, f.stranger, target(), request(), finalizeArchive)).rejects.toThrow();
    expect(await db('co_managed_relationship_closures').where({ tenant: f.msp }).count('* as n').first()).toMatchObject({ n: '0' });
    expect(await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).first('state')).toMatchObject({ state: 'active' });
  });

  it('A1: the review warns about seats and does not block', async () => {
    const review = await getCoManagedDepartureScreen(db, f.mspAdmin, undefined,
      { side: 'sponsor', customerTenant: f.customer, relationshipId: f.relationshipId, sponsorTenant: f.msp });
    expect(review).toMatchObject({ departed: false, seatsToRelease: 3, revision: 1 });
  });

  it('A1: allocate then close releases the seats exactly once', async () => {
    const receipt = await closeCoManagedRelationship(db, f.mspAdmin, target(), request(), finalizeArchive);
    expect(receipt).toMatchObject({ releasedSeats: f.seats, relationshipId: f.relationshipId });
    const allocation = await db('co_managed_allocations').where({ tenant: f.msp, relationship_id: f.relationshipId }).first();
    expect(allocation).toMatchObject({ state: 'released' });
    expect(allocation.released_at).toBeTruthy();
    const relationship = await db('co_management_relationships').where({ tenant: f.customer, relationship_id: f.relationshipId }).first();
    expect(relationship).toMatchObject({ state: 'terminated' });
    expect(relationship.ended_at).toBeTruthy();
  });

  it('A1: replay yields one closure row, no second release and the same receipt', async () => {
    const again = await closeCoManagedRelationship(db, f.mspAdmin, target(), request(), finalizeArchive);
    expect(again.releasedSeats).toBe(f.seats);
    expect(await db('co_managed_relationship_closures').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
    expect(await db('co_managed_archive_manifests').where({ tenant: f.msp, relationship_id: f.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
    expect(await db('co_managed_archive_files').where({ tenant: f.msp, customer_tenant: f.customer, relationship_id: f.relationshipId })).toHaveLength(1);
  });

  it('A1: the same operation with different input is a conflict, and a different operation on a closed relationship is refused', async () => {
    await expect(closeCoManagedRelationship(db, f.mspAdmin, target(), request({ expectedRevision: 7 }), finalizeArchive))
      .rejects.toMatchObject({ code: 'CLOSURE_CHANGED' });
    await expect(closeCoManagedRelationship(db, f.mspAdmin, target(), request({ operationId: randomUUID() }), finalizeArchive))
      .rejects.toBeInstanceOf(CoManagedClosureError);
  });

  it('A2: the archive keeps retained evidence and omits customer-private and post-cutoff content', async () => {
    const list = await listCoManagedArchives(db, f.mspAdmin);
    expect(list.items).toHaveLength(1);
    const history = await getCoManagedArchiveHistory(db, f.mspAdmin, operationId);
    const ids = history.entries.map(entry => entry.id);
    for (const kept of ['sharedMessage', 'requesterMessage', 'privateMessage', 'audit'] as const) expect(ids).toContain(f.evidence[kept]);
    for (const dropped of ['customerPrivate', 'afterCutoff', 'customerOrgPrivate', 'customerPrivateAsPrivateConversation'] as const) expect(ids).not.toContain(f.evidence[dropped]);
    expect(history.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'time_entry', event: 'time_recorded', audience: 'organization_private' })]));
    const text = JSON.stringify(history);
    expect(text).not.toContain('CUSTOMER-PRIVATE SECRET');
    expect(text).not.toContain('POST-CUTOFF SECRET');
    expect(text).not.toContain('CUSTOMER-ORG-PRIVATE SECRET');
    expect(text).not.toContain('CUSTOMER-AS-PRIVATE-CONVERSATION SECRET');
    expect(history.exclusions).toEqual(expect.arrayContaining([
      { evidenceClass: 'conversation', reason: 'audience_not_allowlisted', count: 2 },
      { evidenceClass: 'private_conversation', reason: 'audience_not_allowlisted', count: 1 },
      { evidenceClass: 'conversation', reason: 'after_cutoff', count: 1 }]));
    expect(history.files).toHaveLength(1);
    expect(history.files[0].archiveFileId).not.toBe(fileId);
    expect(await readCoManagedArchiveFile(db, f.mspAdmin, history.files[0].archiveFileId)).toMatchObject({ fileName: 'handoff.txt', size: retainedBytes.length });
    const opened = await readCoManagedArchiveFile(db, f.mspAdmin, history.files[0].archiveFileId);
    expect(Buffer.from(opened!.body as Uint8Array)).toEqual(Buffer.from(retainedBytes));
  });

  it('A2: evidence guessed by id outside the sealed manifest is unreachable, and an unsourced file id is a 404', async () => {
    const history = await getCoManagedArchiveHistory(db, f.mspAdmin, operationId, 0);
    expect(history.entries.every(entry => entry.id !== f.evidence.customerPrivate)).toBe(true);
    expect(await readCoManagedArchiveFile(db, f.mspAdmin, randomUUID())).toBeNull();
    expect(await readCoManagedArchiveFile(db, f.stranger, history.files[0].archiveFileId)).toBeNull();
  });

  it('A2: a reader without co_management:read gets nothing', async () => {
    await expect(listCoManagedArchives(db, f.stranger)).rejects.toThrow();
  });

  it('A1 (R1): concurrent replays and concurrent distinct operations release the seats exactly once', async () => {
    const g = await seedBoundaryFixture(db);
    const same = randomUUID();
    const t = { customerTenant: g.customer, relationshipId: g.relationshipId };
    const req = { operationId: same, expectedRevision: 1, reason: 'departure' as const };
    const settled = await Promise.allSettled([
      closeCoManagedRelationship(db, g.mspAdmin, t, req, finalizeArchive),
      closeCoManagedRelationship(db, g.mspAdmin, t, req, finalizeArchive),
      closeCoManagedRelationship(db, g.customerAdmin, t, { ...req, operationId: randomUUID() }, finalizeArchive),
    ]);
    const receipts = settled.filter(r => r.status === 'fulfilled').map(r => (r as PromiseFulfilledResult<any>).value);
    expect(receipts.length).toBeGreaterThanOrEqual(1);
    // Every successful caller saw the same single release; the competing different operation was refused.
    expect(new Set(receipts.map(r => r.operationId)).size).toBe(1);
    expect(receipts.every(r => r.releasedSeats === g.seats)).toBe(true);
    expect(await db('co_managed_relationship_closures').where({ tenant: g.msp, relationship_id: g.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
    expect(await db('co_managed_archive_manifests').where({ tenant: g.msp, relationship_id: g.relationshipId }).count('* as n').first()).toMatchObject({ n: '1' });
    const allocations = await db('co_managed_allocations').where({ tenant: g.msp, relationship_id: g.relationshipId });
    expect(allocations).toHaveLength(1);
    expect(allocations[0]).toMatchObject({ state: 'released' });
  });
});
