/**
 * L7a on real Postgres (A1, A2): relationship closure releases exactly once; replay is idempotent;
 * an unauthorized party is refused; the sealed MSP archive holds retained participation evidence only.
 */
import { createHash, randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { closeCoManagedRelationship, departCoManagedRelationship, CoManagedClosureError, finalizeCoManagedArchive, getCoManagedArchiveHistory, getCoManagedDepartureScreen,
  listCoManagedArchives, readCoManagedArchiveFile, retainCoManagedTimeParticipation, retainFile, storeCoManagedArchiveFiles } from '@alga-psa/co-managed';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { seedBoundaryFixture, type BoundaryFixture } from './coManagedArchiveBoundaryCases';

const describeDb = await describeWithDb();
const { retainedBytes, retentionFailure } = vi.hoisted(() => ({ retainedBytes: new Uint8Array(Buffer.from('actual retained file')),
  retentionFailure: { mode: 'none' as 'none' | 'download' | 'integrity', attachmentId: null as string | null } }));
vi.mock('@alga-psa/storage/StorageProviderFactory', () => ({
  StorageProviderFactory: { createProvider: async () => ({
    download: async (path: string) => {
      if (path.endsWith(retentionFailure.attachmentId ?? '\u0000') && retentionFailure.mode === 'download') throw new Error('s3://private-bucket?secret=not-for-evidence');
      if (path.endsWith(retentionFailure.attachmentId ?? '\u0000') && retentionFailure.mode === 'integrity') return new Uint8Array(Buffer.from('corrupt bytes'));
      return retainedBytes;
    },
    upload: async (bytes: Uint8Array, path: string) => ({ path, size: bytes.length }),
  }) },
}));

async function seedTicketWithCurrentGrant(db: Knex, f: BoundaryFixture) {
  const clientId = randomUUID(), boardId = randomUUID(), statusId = randomUUID(), priorityId = randomUUID();
  await db('clients').insert({ tenant: f.customer, client_id: clientId, client_name: `Archive ${clientId.slice(0, 8)}`,
    billing_cycle: 'monthly', is_tax_exempt: false });
  await db('boards').insert({ tenant: f.customer, board_id: boardId, board_name: `Archive ${boardId.slice(0, 8)}`, is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant: f.customer, priority_id: priorityId, priority_name: 'Normal', item_type: 'ticket', color: '#777777', order_number: 10, created_by: f.customerAdmin.userId });
  await db('statuses').insert({ tenant: f.customer, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false,
    is_default: true, order_number: 10, created_by: f.customerAdmin.userId });
  await db('tickets').insert({ tenant: f.customer, ticket_id: f.resourceId, ticket_number: `ARCHIVE-${randomUUID()}`, title: 'Archive evidence',
    client_id: clientId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: f.customerAdmin.userId });
  await db('co_management_ticket_work').insert({ tenant: f.customer, relationship_id: f.relationshipId, ticket_id: f.resourceId,
    work_id: randomUUID(), revision: 1, responsibility: 'customer', can_collaborate: true,
    first_escalated_at: new Date(), last_transition_at: new Date() });
}

async function seedCurrentComment(db: Knex, f: BoundaryFixture, audience: 'shared_it' | 'organization_private', commentId: string, threadId: string) {
  const isInternal = audience !== 'requester';
  await db('comment_threads').insert({ tenant: f.customer, thread_id: threadId, ticket_id: f.resourceId, root_comment_id: commentId,
    is_internal: isInternal, collaboration_audience: audience, created_by: f.customerAdmin.userId });
  await db('comments').insert({ tenant: f.customer, comment_id: commentId, thread_id: threadId, ticket_id: f.resourceId,
    user_id: f.customerAdmin.userId, author_type: 'internal', note: 'Current comment visibility', is_internal: isInternal, is_resolution: false });
}

async function seedCustomerAttachment(db: Knex, f: BoundaryFixture, commentId: string, threadId: string, name: string) {
  const attachmentId = randomUUID();
  await db('co_management_conversation_attachments').insert({ tenant: f.customer, attachment_id: attachmentId, customer_tenant: f.customer,
    relationship_id: f.relationshipId, ticket_id: f.resourceId, thread_id: threadId, comment_id: commentId, actor_tenant: f.customer,
    actor_user_id: f.customerAdmin.userId, file_name: name, mime_type: 'text/plain', file_size: retainedBytes.length,
    content_hash: createHash('sha256').update(retainedBytes).digest('hex'), request_hash: randomUUID().replace(/-/g, '').padEnd(64, 'a').slice(0, 64),
    storage_path: `co-management/${f.customer}/${attachmentId}`, status: 'ready', ready_at: new Date(), draft_operation_id: null });
  return attachmentId;
}

describeDb('co-managed closure and archive on real Postgres', { shuffle: false }, () => {
  let db: Knex; let f: BoundaryFixture; const operationId = randomUUID(); const fileId = randomUUID();
  const finalizeArchive = finalizeCoManagedArchive;
  const target = () => ({ customerTenant: f.customer, relationshipId: f.relationshipId });
  const request = (extra: object = {}) => ({ operationId, expectedRevision: 1, reason: 'departure' as const, ...extra });
  beforeAll(async () => {
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    db = await createTestDbConnection({ databaseName: 'l7a_closure_archive_test' });
    f = await seedBoundaryFixture(db);
    await seedTicketWithCurrentGrant(db, f);
    await seedCurrentComment(db, f, 'shared_it', f.fileCommentId, f.fileThreadId);
    await seedCurrentComment(db, f, 'organization_private', f.privateFileCommentId, f.privateFileThreadId);
    const entryId = randomUUID();
    await db('time_entries').insert({ tenant: f.msp, entry_id: entryId, user_id: f.mspAdmin.userId, work_date: new Date(Date.now() - 900_000), work_timezone: 'UTC', start_time: new Date(Date.now() - 1800_000),
      end_time: new Date(Date.now() - 900_000), work_item_type: 'co_managed', work_item_id: randomUUID(), created_at: new Date(Date.now() - 900_000) });
    await db('co_managed_time_work_references').insert({ tenant: f.msp, entry_id: entryId, customer_tenant: f.customer,
      relationship_id: f.relationshipId, source_kind: 'ticket', source_id: f.resourceId, local_reference_id: randomUUID(),
      client_id: f.sponsorClient, title: 'Shared work', ticket_number: 'L7-TIME' });
    await db.transaction(trx => retainCoManagedTimeParticipation(trx, f.msp, entryId));
    const contentHash = createHash('sha256').update(retainedBytes).digest('hex');
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
  afterAll(async () => { delete process.env.FORCE_CAPABILITIES; retentionFailure.mode = 'none'; retentionFailure.attachmentId = null; await db?.destroy(); });

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

  it('selects and closes the current open relationship while preserving older terminated history', async () => {
    const g = await seedBoundaryFixture(db);
    const historicalId = randomUUID(), historicalEnd = new Date(Date.now() - 86_400_000);
    await db('co_management_relationships').insert({ tenant: g.customer, relationship_id: historicalId, sponsor_tenant: g.msp,
      sponsor_client_id: g.sponsorClient, state: 'terminated', visibility_mode: 'board_scope', revision: 2,
      accepted_by: g.customerAdmin.userId, accepted_at: historicalEnd, ended_at: historicalEnd, created_at: historicalEnd, updated_at: historicalEnd });
    const review = await getCoManagedDepartureScreen(db, g.customerAdmin);
    expect(review.relationshipId).toBe(g.relationshipId);
    const request = { operationId: randomUUID(), expectedRevision: 1, relationshipId: g.relationshipId };
    const receipt = await departCoManagedRelationship(db, g.customerAdmin, request);
    await expect(departCoManagedRelationship(db, g.customerAdmin, request)).resolves.toEqual(receipt);
    await expect(departCoManagedRelationship(db, g.customerAdmin, { ...request, expectedRevision: 2 }))
      .rejects.toMatchObject({ code: 'CLOSURE_CHANGED' });
    const [historical, current] = await Promise.all([
      db('co_management_relationships').where({ tenant: g.customer, relationship_id: historicalId }).first(),
      db('co_management_relationships').where({ tenant: g.customer, relationship_id: g.relationshipId }).first(),
    ]);
    const [closures, released] = await Promise.all([
      db('co_managed_relationship_closures').where({ tenant: g.msp, relationship_id: g.relationshipId }),
      db('co_managed_allocations').where({ tenant: g.msp, relationship_id: g.relationshipId, state: 'released' }),
    ]);
    expect(historical).toMatchObject({ state: 'terminated', ended_at: historicalEnd });
    expect(current).toMatchObject({ state: 'terminated' });
    expect(current.ended_at).toBeTruthy();
    expect(receipt.releasedSeats).toBe(g.seats);
    expect(closures).toHaveLength(1);
    expect(closures[0].released_seats).toBe(g.seats);
    expect(released).toHaveLength(1);
  });

  for (const mode of ['download', 'integrity'] as const) {
    it(`closes and retries safely when attachment ${mode} fails`, async () => {
      const g = await seedBoundaryFixture(db);
      await seedTicketWithCurrentGrant(db, g);
      await seedCurrentComment(db, g, 'shared_it', g.fileCommentId, g.fileThreadId);
      const attachmentId = await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, `${mode}.txt`);
      const retainedAttachmentId = await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, `also-retained-${mode}.txt`);
      retentionFailure.mode = mode;
      retentionFailure.attachmentId = attachmentId;
      const operationId = randomUUID(), target = { customerTenant: g.customer, relationshipId: g.relationshipId };
      const input = { operationId, expectedRevision: 1, reason: 'departure' as const };
      try {
        const receipt = await closeCoManagedRelationship(db, g.mspAdmin, target, input, finalizeArchive);
        const relationship = await db('co_management_relationships').where({ tenant: g.customer, relationship_id: g.relationshipId }).first();
        const allocation = await db('co_managed_allocations').where({ tenant: g.msp, relationship_id: g.relationshipId }).first();
        const manifestRow = await db('co_managed_archive_manifests').where({ tenant: g.msp, operation_id: operationId }).first();
        const manifest = typeof manifestRow.manifest === 'string' ? JSON.parse(manifestRow.manifest) : manifestRow.manifest;
        expect(relationship).toMatchObject({ state: 'terminated' });
        expect(relationship.ended_at).toBeTruthy();
        expect(receipt.releasedSeats).toBe(g.seats);
        expect(allocation).toMatchObject({ state: 'released' });
        expect(manifest.retentionFailures).toHaveLength(2); // two retained evidence events point at this attachment
        expect(manifest.retentionFailures.every((failure: any) => failure.attachmentId === attachmentId && failure.status === 'retention_failed' &&
          failure.reason === (mode === 'download' ? 'source_download_failed' : 'source_integrity_failed'))).toBe(true);
        expect(JSON.stringify(manifest.retentionFailures)).not.toContain('private-bucket');
        expect(manifest.evidence.some(([id]: [string, string]) => id === g.evidence.sharedMessage)).toBe(true);
        const retainedRow = await db('co_managed_archive_files').where({ tenant: g.msp, attachment_id: retainedAttachmentId }).first();
        expect(manifest.files).toEqual([[retainedRow.archive_file_id, retainedRow.content_hash, retainedRow.file_size]]);
        expect(await db('co_managed_archive_files').where({ tenant: g.msp, attachment_id: attachmentId })).toHaveLength(0);
        const listed = await listCoManagedArchives(db, g.mspAdmin);
        expect(listed.items).toEqual(expect.arrayContaining([expect.objectContaining({ operationId })]));
        const history = await getCoManagedArchiveHistory(db, g.mspAdmin, operationId);
        expect(history.retentionFailures).toHaveLength(2);
        expect(history.files).toEqual([expect.objectContaining({ archiveFileId: retainedRow.archive_file_id, size: retainedBytes.length })]);
        const reopened = await readCoManagedArchiveFile(db, g.mspAdmin, retainedRow.archive_file_id);
        expect(reopened?.fileName).toBe(`also-retained-${mode}.txt`);
        expect(Buffer.from(reopened!.body as Uint8Array)).toEqual(Buffer.from(retainedBytes));
        const retry = await closeCoManagedRelationship(db, g.mspAdmin, target, input, finalizeArchive);
        expect(retry).toEqual(receipt);
        expect(await db('co_managed_relationship_closures').where({ tenant: g.msp, relationship_id: g.relationshipId })).toHaveLength(1);
        expect(await db('co_managed_allocations').where({ tenant: g.msp, relationship_id: g.relationshipId, state: 'released' })).toHaveLength(1);
      } finally {
        retentionFailure.mode = 'none';
        retentionFailure.attachmentId = null;
      }
    });
  }

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
    expect(await storeCoManagedArchiveFiles(db, f.msp)).toEqual({ stored: 1, failed: 0 });
    expect(await db('co_managed_archive_files').where({ tenant: f.msp, archive_file_id: history.files[0].archiveFileId })
      .first('status', 'staged_bytes')).toMatchObject({ status: 'ready', staged_bytes: null });
    const fromObjectStorage = await readCoManagedArchiveFile(db, f.mspAdmin, history.files[0].archiveFileId);
    expect(Buffer.from(fromObjectStorage!.body as Uint8Array)).toEqual(Buffer.from(retainedBytes));
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

  it('does not retain a new customer file when historical shared evidence now points to a private comment', async () => {
    const g = await seedBoundaryFixture(db);
    await seedTicketWithCurrentGrant(db, g);
    await seedCurrentComment(db, g, 'organization_private', g.fileCommentId, g.fileThreadId);
    await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, 'uploaded-after-audience-narrowing.txt');
    const operationId = randomUUID();
    await closeCoManagedRelationship(db, g.mspAdmin, { customerTenant: g.customer, relationshipId: g.relationshipId },
      { operationId, expectedRevision: 1, reason: 'departure' }, finalizeArchive);
    expect((await getCoManagedArchiveHistory(db, g.mspAdmin, operationId)).files).toHaveLength(0);
    expect(await db('co_managed_archive_files').where({ tenant: g.msp, customer_tenant: g.customer, relationship_id: g.relationshipId })).toHaveLength(0);
  });

  it('does not retain a new shared-looking file after the current ticket grant was revoked', async () => {
    const g = await seedBoundaryFixture(db);
    await seedTicketWithCurrentGrant(db, g);
    await seedCurrentComment(db, g, 'shared_it', g.fileCommentId, g.fileThreadId);
    await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, 'uploaded-after-sharing-revocation.txt');
    await db('co_management_ticket_work').where({ tenant: g.customer, relationship_id: g.relationshipId, ticket_id: g.resourceId })
      .update({ grant_revoked_at: new Date(), responsibility: 'customer', can_collaborate: false, first_escalated_at: null, last_transition_at: null });
    const operationId = randomUUID();
    await closeCoManagedRelationship(db, g.mspAdmin, { customerTenant: g.customer, relationshipId: g.relationshipId },
      { operationId, expectedRevision: 1, reason: 'departure' }, finalizeArchive);
    expect((await getCoManagedArchiveHistory(db, g.mspAdmin, operationId)).files).toHaveLength(0);
    expect(await db('co_managed_archive_files').where({ tenant: g.msp, customer_tenant: g.customer, relationship_id: g.relationshipId })).toHaveLength(0);
  });

  it.each(['attachments', 'conversation'])('redaction of %s prevents new file retention but preserves bytes already retained by the sponsor', async (redaction) => {
    const g = await seedBoundaryFixture(db);
    await seedTicketWithCurrentGrant(db, g);
    await seedCurrentComment(db, g, 'shared_it', g.fileCommentId, g.fileThreadId);
    const previouslyRetainedId = await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, 'previously-retained.txt');
    await db.transaction(trx => retainFile(trx, { tenant: g.msp, sourceTenant: g.customer, fileId: previouslyRetainedId,
      hash: createHash('sha256').update(retainedBytes).digest('hex'), relationshipId: g.relationshipId, clientId: g.sponsorClient, audience: 'shared_it' }));
    await db('co_management_relationships').where({ tenant: g.customer, relationship_id: g.relationshipId }).update({ redacted_fields: [redaction] });
    await seedCustomerAttachment(db, g, g.fileCommentId, g.fileThreadId, 'newly-redacted.txt');

    const operationId = randomUUID();
    await closeCoManagedRelationship(db, g.mspAdmin, { customerTenant: g.customer, relationshipId: g.relationshipId },
      { operationId, expectedRevision: 1, reason: 'departure' }, finalizeArchive);
    const history = await getCoManagedArchiveHistory(db, g.mspAdmin, operationId);
    expect(history.files).toHaveLength(1);
    const opened = await readCoManagedArchiveFile(db, g.mspAdmin, history.files[0].archiveFileId);
    expect(opened?.fileName).toBe('previously-retained.txt');
    expect(Buffer.from(opened!.body as Uint8Array)).toEqual(Buffer.from(retainedBytes));
    expect(await db('co_managed_archive_files').where({ tenant: g.msp, customer_tenant: g.customer, relationship_id: g.relationshipId }))
      .toHaveLength(1);
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
