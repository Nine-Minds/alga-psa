import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { expect, it, vi } from 'vitest';

type Fixture = (work: (fixture: any) => Promise<void>) => Promise<void>;

export function registerCoManagedArchiveBoundaryTests(getDb: () => Knex, withAttachmentFixture: Fixture, withTaskConversationFixture: Fixture) {
  it('archive boundary paginates authorized work without hidden-only pages or candidate counts', async () => withAttachmentFixture(async f => {
    const db = getDb(), archive = await import('../../../../packages/co-managed/src/archiveReads');
    const bundles = await import('@alga-psa/authorization');
    await f.create(f.principal, { operationId: randomUUID(), audience: 'shared_it', text: 'Visible archive work' });
    const template = await f.sponsor.table('co_managed_participation_evidence').where('resource_id', f.resource.id).first();
    expect(template).toBeDefined();
    const hiddenClient = randomUUID();
    // Retained evidence deliberately outlives live resources and supplies its own
    // home-client policy projection, including records whose source was deleted.
    const rows = Array.from({ length: 56 }, (_, index) => ({ ...template, evidence_id: randomUUID(), source_id: randomUUID(),
      resource_id: `${index < 30 ? '00000000' : '10000000'}-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
      client_id: index < 30 ? hiddenClient : template.client_id }));
    await f.sponsor.table('co_managed_participation_evidence').insert(rows);
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(db, { tenant: f.principal.tenant, name: 'Archive pagination scope', actorUserId: f.principal.userId });
    await bundles.upsertBundleRule(db, { tenant: f.principal.tenant, bundleId, revisionId, resourceType: 'ticket', action: 'read', templateKey: 'selected_clients',
      config: { selectedClientIds: [randomUUID()] } });
    await bundles.publishBundleRevision(db, { tenant: f.principal.tenant, bundleId, revisionId, actorUserId: f.principal.userId });
    await bundles.createBundleAssignment(db, { tenant: f.principal.tenant, bundleId, targetType: 'user', targetId: f.principal.userId });
    expect(await archive.listCoManagedArchiveWork(db, f.principal)).toEqual({ items: [], nextPage: null });
    const rule = () => f.sponsor.table('authorization_bundle_rules').where({ bundle_id: bundleId, resource_type: 'ticket', action: 'read' });
    await rule().update({ config: { selectedClientIds: [template.client_id] } });
    const first = await archive.listCoManagedArchiveWork(db, f.principal), second = await archive.listCoManagedArchiveWork(db, f.principal, 1);
    expect(first.items).toHaveLength(25); expect(first.nextPage).toBe(1);
    expect(second.items).toHaveLength(2); expect(second.nextPage).toBeNull();
    expect(new Set([...first.items, ...second.items].map(item => item.resource.id)).size).toBe(27);
    expect([...first.items, ...second.items].every(item => item.clientId === template.client_id)).toBe(true);
    expect(await archive.listCoManagedArchiveWork(db, f.principal, 2)).toEqual({ items: [], nextPage: null });
    await rule().update({ config: { selectedClientIds: [template.client_id], redactedFields: ['resource'] } });
    expect(await archive.listCoManagedArchiveWork(db, f.principal)).toEqual({ items: [], nextPage: null });
  }));

  it('archive boundary paginates history after private-source and time-entry policy admission', async () => withAttachmentFixture(async f => {
    const db = getDb(), archive = await import('../../../../packages/co-managed/src/archiveReads');
    const bundles = await import('@alga-psa/authorization');
    const { createSharedTicketComment } = await import('../../lib/co-managed/createTicketComment');
    await createSharedTicketComment(db, f.principal, f.resource, { operationId: randomUUID(), audience: 'shared_it', text: 'Visible history' });
    const before = await archive.getCoManagedArchiveHistory(db, f.principal, f.resource);
    const template = await f.sponsor.table('co_managed_participation_evidence').where({ resource_id: f.resource.id, source_type: 'conversation' }).first();
    expect(template).toBeDefined();
    const hidden = Array.from({ length: 104 }, (_, index) => ({ ...template, evidence_id: randomUUID(), source_id: randomUUID(),
      source_type: index < 52 ? 'private_conversation' : 'time_entry', occurred_at: new Date(Date.now() + 1000),
      payload: { ...template.payload, audience: 'organization_private', note: 'Hidden history' } }));
    await f.sponsor.table('co_managed_participation_evidence').insert(hidden);
    const { bundleId, revisionId } = await bundles.createAuthorizationBundle(db, { tenant: f.principal.tenant, name: 'Archive history scope', actorUserId: f.principal.userId });
    await bundles.upsertBundleRule(db, { tenant: f.principal.tenant, bundleId, revisionId, resourceType: 'ticket', action: 'read', templateKey: 'selected_clients',
      config: { selectedClientIds: [template.client_id], redactedFields: ['co_management_private_comments'] } });
    await bundles.upsertBundleRule(db, { tenant: f.principal.tenant, bundleId, revisionId, resourceType: 'time_entry', action: 'read', templateKey: 'selected_clients',
      config: { selectedClientIds: [randomUUID()] } });
    await bundles.publishBundleRevision(db, { tenant: f.principal.tenant, bundleId, revisionId, actorUserId: f.principal.userId });
    await bundles.createBundleAssignment(db, { tenant: f.principal.tenant, bundleId, targetType: 'user', targetId: f.principal.userId });
    expect(await archive.getCoManagedArchiveHistory(db, f.principal, f.resource)).toEqual(before);
    const visible = Array.from({ length: 51 }, () => ({ ...template, evidence_id: randomUUID(), source_id: randomUUID() }));
    await f.sponsor.table('co_managed_participation_evidence').insert(visible);
    const first = await archive.getCoManagedArchiveHistory(db, f.principal, f.resource), second = await archive.getCoManagedArchiveHistory(db, f.principal, f.resource, 1);
    expect(first.entries).toHaveLength(50); expect(first.nextPage).toBe(1);
    expect(second.entries).toHaveLength(before.entries.length + 1); expect(second.nextPage).toBeNull();
    expect(new Set([...first.entries, ...second.entries].map(entry => entry.id)).size).toBe(before.entries.length + 51);
    expect([...first.entries, ...second.entries].some(entry => entry.note === 'Hidden history')).toBe(false);
    expect((await archive.getCoManagedArchiveHistory(db, f.principal, f.resource, 2))).toMatchObject({ entries: [], nextPage: null });
  }));

  it('archive boundary downloads task bytes through the qualified route and rejects ambiguous parent identities', async () => withTaskConversationFixture(async f => {
    const db = getDb(), attachments = await import('../../../../packages/co-managed/src/conversationAttachments');
    const archive = await import('../../../../packages/co-managed/src/archiveReads');
    const comment = f.ref(await f.add(f.principal, 'shared_it', 'Task archive download'));
    const bytes = Buffer.from('Retained task bytes');
    await attachments.uploadCoManagedConversationAttachment(db, f.principal, f.resource,
      { attachmentId: randomUUID(), comment, fileName: 'Task.txt', mimeType: 'text/plain', content: bytes }, async () => {});
    const file = (await archive.listCoManagedArchiveFiles(db, f.principal, f.resource)).items[0];
    const auth = await import('@alga-psa/auth'), dbModule = await import('@alga-psa/db');
    const session = vi.spyOn(auth, 'getSession').mockResolvedValue({ session_id: f.principal.sessionId,
      user: { tenant: f.principal.tenant, id: f.principal.userId, user_type: 'internal' } } as any);
    const override = vi.spyOn(auth, 'getApiKeyUserOverride').mockReturnValue(undefined), connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(db);
    try {
      const { GET } = await import('../../app/api/co-management/archive-files/[archiveFileId]/route');
      const { NextRequest } = await import('next/server');
      const query = new URLSearchParams({ customerTenant: f.resource.tenant, relationshipId: f.resource.relationshipId, taskId: f.resource.id });
      const get = (params: URLSearchParams) => GET(new NextRequest(`http://localhost/api/co-management/archive-files/${file.archiveFileId}?${params}`),
        { params: Promise.resolve({ archiveFileId: file.archiveFileId }) });
      const response = await get(query);
      expect(response.status).toBe(200); expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes);
      expect(response.headers.get('cache-control')).toBe('no-store, private');
      expect(response.headers.get('content-disposition')).toContain('attachment;');
      for (const key of ['taskId', 'ticketId', 'customerTenant', 'relationshipId', 'storeTenant', 'kind']) {
        const ambiguous = new URLSearchParams(query); ambiguous.append(key, randomUUID());
        expect((await get(ambiguous)).status).toBe(404);
      }
      for (const key of ['taskId', 'customerTenant', 'relationshipId']) {
        const missing = new URLSearchParams(query); missing.delete(key); expect((await get(missing)).status).toBe(404);
      }
      const wrongKind = new URLSearchParams(query); wrongKind.delete('taskId'); wrongKind.set('ticketId', f.resource.id);
      expect((await get(wrongKind)).status).toBe(404);
      override.mockReturnValue({ user_id: f.principal.userId } as any); expect((await get(query)).status).toBe(401);
    } finally { session.mockRestore(); override.mockRestore(); connection.mockRestore(); }
  }));
}
