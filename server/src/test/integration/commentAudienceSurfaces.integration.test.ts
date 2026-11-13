import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { randomUUID } from 'node:crypto';
import {
  isCommentAudienceVisible, resolveCommentAudienceForRead, resolveCommentAudienceReader, type CommentAudienceReader,
} from '@alga-psa/shared/lib/commentAudience';
import { canReadCommentAttachment, filterReadableCommentAttachments } from '@alga-psa/shared/lib/ticketCommentAttachments';
import { buildUnifiedTicketTimeline, readTicketActivity, writeTicketActivity } from '@alga-psa/shared/lib/ticketActivity';
import { ticketCommentIndexer } from '@alga-psa/search/indexers/ticket_comment';
import { upsertSearchDoc } from '@alga-psa/search/upsert';
import { resolveSearchAclPrincipal, verifyResultVisibility, type SearchAclPrincipal } from '@alga-psa/search/acl';
import { runSearchQuery } from '@alga-psa/search/query';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import Comment from '../../../../packages/tickets/src/models/comment';

/**
 * S18 (T023): the comment audience carried into the surfaces that show note content sideways.
 *
 * One ticket of a client with a live seat arrangement holds ten legacy internal notes (internal,
 * no stored audience), one shared IT note and one requester-visible comment; some carry an
 * attachment, each has an activity row and a search document. A seat technician of that client
 * reads none of the ten in the conversation, the activity list, attachments or search, and still
 * reads the other two. MSP staff read everything, as before.
 *
 * The seat technician is a real internal user holding an active assignment, written directly: no
 * invitation command is on main.
 */
describe('comment audience in attachments, activity and search (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let ticketId: string;
  let clientId: string;
  let mspUser: string;
  let seatUser: string;
  let arrangementId: string;
  const TERM = `quillfeather${randomUUID().slice(0, 8)}`;
  const privateNotes: string[] = [];
  let sharedNote: string;
  let requesterComment: string;
  /** comment id -> document id of its attachment. */
  const attachments = new Map<string, string>();
  const deletedCommentId = randomUUID();
  /** A ticket document that is no comment's attachment. */
  const plainDocumentId = randomUUID();
  const auditIds: string[] = [];

  const t = (table: string) => tenantDb(knex, tenant).table(table);
  const mine = () => [...privateNotes, sharedNote, requesterComment];
  const sorted = (ids: Iterable<string>) => [...ids].sort();
  const onlyMine = (ids: Array<string | null | undefined>) => sorted(ids.filter((id): id is string => !!id && mine().includes(id)));

  async function comment(fields: Record<string, unknown>, author?: CommentAudienceReader | null) {
    return Comment.insert(knex, tenant, {
      ticket_id: ticketId, user_id: mspUser, author_type: 'internal', is_resolution: false, ...fields,
    } as any, undefined, author);
  }

  async function attach(commentId: string) {
    const documentId = randomUUID();
    await t('documents').insert({ tenant, document_id: documentId, document_name: `${TERM}-${documentId.slice(0, 6)}.png`, user_id: mspUser, created_by: mspUser });
    await t('ticket_comment_attachments').insert({ tenant, ticket_id: ticketId, document_id: documentId, created_by: mspUser,
      comment_id: commentId, state: 'attached', expires_at: new Date(Date.now() + 86_400_000) });
    attachments.set(commentId, documentId);
    return documentId;
  }

  async function activity(eventType: string, entityType: 'comment' | 'document' | 'ticket', entityId: string, sink: string[] = auditIds) {
    const before = new Set((await t('ticket_audit_logs').where({ ticket_id: ticketId }).select('audit_id')).map(row => row.audit_id));
    await writeTicketActivity(knex, { tenant, ticketId, eventType, entityType, entityId,
      actor: { actorType: 'user', userId: mspUser }, source: 'ui', details: { marker: TERM } } as any);
    const added = (await t('ticket_audit_logs').where({ ticket_id: ticketId }).select('audit_id')).map(row => row.audit_id).filter(id => !before.has(id));
    sink.push(...added);
  }

  async function searchPrincipal(userId: string): Promise<SearchAclPrincipal> {
    const principal = await runWithTenant(tenant, () => resolveSearchAclPrincipal(knex, { user_id: userId, user_type: 'internal', tenant } as any, { mode: 'all' }));
    // The audience is the subject here, not RBAC: both readers hold ticket:read.
    return { ...principal, permissions: [...new Set([...principal.permissions, 'ticket:read'])] };
  }

  const searchHits = (acl: SearchAclPrincipal) => runSearchQuery({ knex, tenant, query: TERM, allowedTypes: ['ticket_comment'] as any, acl, limit: 50 });

  beforeAll(async () => {
    knex = await createTestDbConnection();
    (globalThis as any).__algaWriteAdmissionState = undefined;
    (globalThis as any).__algaWriteAdmissionResolver = undefined;
    const d = tenantDb(knex, '__test_discovery__');
    const found = (await d.unscoped('tickets as t', 'test discovery')
      .whereNotNull('t.client_id')
      .whereRaw(`NOT EXISTS (SELECT 1 FROM co_managed_seat_arrangements ar WHERE ar.tenant = t.tenant AND ar.client_id = t.client_id AND ar.state <> 'ended')`)
      .whereRaw(`(SELECT count(*) FROM users u WHERE u.tenant = t.tenant AND u.user_type = 'internal' AND u.is_inactive = false) >= 2`)
      .select('t.tenant', 't.ticket_id', 't.client_id').first()) as { tenant: string; ticket_id: string; client_id: string } | undefined;
    if (!found) throw new Error('fixture: need a client ticket in a tenant with two internal users');
    ({ tenant, ticket_id: ticketId, client_id: clientId } = found);
    const users = await t('users').where({ user_type: 'internal', is_inactive: false })
      .whereRaw(`NOT EXISTS (SELECT 1 FROM co_managed_seat_assignments sa WHERE sa.tenant = users.tenant AND sa.user_id = users.user_id AND sa.state <> 'revoked')`)
      .orderBy('user_id').limit(2).select('user_id');
    if (users.length < 2) throw new Error('fixture: two free internal users are required');
    [mspUser, seatUser] = users.map(row => row.user_id);

    arrangementId = randomUUID();
    await t('co_managed_seat_arrangements').insert({ tenant, arrangement_id: arrangementId, client_id: clientId, allocation_id: randomUUID(), state: 'active' });
    await t('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: seatUser, state: 'active' });
    expect(await resolveCommentAudienceReader(knex, tenant, { userId: mspUser, userType: 'internal' })).toEqual({ kind: 'staff', tenant });
    expect(await resolveCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal' })).toEqual({ kind: 'seat', tenant, clientId });

    for (let n = 0; n < 10; n++) {
      // A legacy internal note: internal, no audience named.
      const body = `${TERM} private note ${n}`;
      privateNotes.push(await comment({ is_internal: true, note: body, markdown_content: body }));
    }
    sharedNote = await comment({ is_internal: true, collaboration_audience: 'shared_it', note: `${TERM} shared note`, markdown_content: `${TERM} shared note` });
    requesterComment = await comment({ is_internal: false, note: `${TERM} requester comment`, markdown_content: `${TERM} requester comment` });
    const legacy = await t('comment_threads').whereIn('root_comment_id', privateNotes).select('collaboration_audience', 'is_internal');
    expect(legacy).toHaveLength(10);
    expect(legacy.every(thread => thread.collaboration_audience === null && thread.is_internal === true)).toBe(true);

    for (const id of [...privateNotes.slice(0, 3), sharedNote, requesterComment]) await attach(id);

    for (const id of privateNotes) await activity('TICKET_INTERNAL_NOTE_ADDED', 'comment', id);
    await activity('TICKET_COMMENT_UPDATED', 'comment', privateNotes[0]);
    await activity('TICKET_DOCUMENT_ATTACHED', 'document', attachments.get(privateNotes[0])!);
    await activity('TICKET_INTERNAL_NOTE_ADDED', 'comment', sharedNote);
    await activity('TICKET_DOCUMENT_ATTACHED', 'document', attachments.get(sharedNote)!);
    await activity('TICKET_COMMENT_ADDED', 'comment', requesterComment);
    // A comment that no longer exists cannot prove its audience.
    await activity('TICKET_INTERNAL_NOTE_ADDED', 'comment', deletedCommentId);
    // Not about a comment at all: a plain ticket event and a document that is no comment's attachment.
    await activity('TICKET_STATUS_CHANGED', 'ticket', ticketId);
    await activity('TICKET_DOCUMENT_ATTACHED', 'document', plainDocumentId);

    for (const id of mine()) {
      const doc = await ticketCommentIndexer.loadOne(knex, tenant, id);
      expect(doc).not.toBeNull();
      await upsertSearchDoc(knex, doc!);
    }
  }, 300_000);

  afterAll(async () => {
    if (!knex) return;
    if (tenant) {
      const ids = [...privateNotes, sharedNote, requesterComment].filter(Boolean);
      await knex('app_search_index').where({ tenant, object_type: 'ticket_comment' }).whereIn('object_id', ids).delete().catch(() => undefined);
      await t('ticket_audit_logs').whereIn('audit_id', auditIds).delete().catch(() => undefined);
      await t('ticket_comment_attachments').whereIn('document_id', [...attachments.values()]).delete().catch(() => undefined);
      await t('documents').whereIn('document_id', [...attachments.values()]).delete().catch(() => undefined);
      for (const id of ids) {
        const c = await t('comments').where({ comment_id: id }).first('thread_id');
        if (!c) continue;
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
        await t('comments').where({ comment_id: id }).delete().catch(() => undefined);
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
      }
      if (arrangementId) {
        await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId }).delete().catch(() => undefined);
        await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).delete().catch(() => undefined);
      }
    }
    await knex.destroy();
  });

  describe('T023 a seat technician sees none of ten legacy internal notes', () => {
    it('in the conversation (F038)', async () => {
      const read = await Comment.getAllbyTicketId(knex, tenant, ticketId, seatUser);
      expect(onlyMine(read.map(c => c.comment_id))).toEqual(sorted([sharedNote, requesterComment]));
      for (const id of privateNotes) expect(await Comment.get(knex, tenant, id, seatUser)).toBeUndefined();
      expect((await Comment.get(knex, tenant, sharedNote, seatUser))?.comment_id).toBe(sharedNote);
    });

    it('in the activity list and the unified timeline (F044)', async () => {
      const rows = (await readTicketActivity(knex, tenant, ticketId, { internalReaderId: seatUser })).filter(row => auditIds.includes(row.audit_id));
      const about = rows.map(row => `${row.entity_type}:${row.entity_id}`).sort();
      expect(about).toEqual([
        `comment:${sharedNote}`, `comment:${requesterComment}`,
        `document:${attachments.get(sharedNote)}`, `ticket:${ticketId}`,
        `document:${plainDocumentId}`,
      ].sort());
      // Nothing about a private note, its attachment or an unresolvable comment.
      const hidden = new Set([...privateNotes, attachments.get(privateNotes[0])!, deletedCommentId]);
      expect(rows.some(row => hidden.has(row.entity_id ?? ''))).toBe(false);

      const timeline = await buildUnifiedTicketTimeline(knex, tenant, ticketId, { internalReaderId: seatUser });
      expect(onlyMine(timeline.filter(e => e.type === 'comment').map(e => e.comment?.comment_id as string))).toEqual(sorted([sharedNote, requesterComment]));
      expect(timeline.some(e => e.type === 'activity' && hidden.has(e.activity?.entity_id ?? ''))).toBe(false);
      expect(JSON.stringify(timeline)).not.toContain(`${TERM} private note`);
    });

    it('in attachments and inline images (F043)', async () => {
      for (const id of privateNotes.slice(0, 3)) {
        expect(await canReadCommentAttachment(knex, tenant, seatUser, attachments.get(id)!)).toBe(false);
      }
      expect(await canReadCommentAttachment(knex, tenant, seatUser, attachments.get(sharedNote)!)).toBe(true);
      expect(await canReadCommentAttachment(knex, tenant, seatUser, attachments.get(requesterComment)!)).toBe(true);
      const listed = await filterReadableCommentAttachments(knex, tenant, seatUser, [...attachments.values()].map(document_id => ({ document_id })));
      expect(sorted(listed.map(d => d.document_id))).toEqual(sorted([attachments.get(sharedNote)!, attachments.get(requesterComment)!]));
    });

    it('in search: neither the index predicate nor the per-row check returns them (F045)', async () => {
      const acl = await searchPrincipal(seatUser);
      expect(acl.audienceReader).toEqual({ kind: 'seat', tenant, clientId });
      const hits = await searchHits(acl);
      expect(sorted(hits.map(h => h.id))).toEqual(sorted([sharedNote, requesterComment]));
      expect(JSON.stringify(hits)).not.toContain('private note');
      // The per-row check alone, handed every row as if the index had returned it.
      const verified = await verifyResultVisibility(knex, acl, mine().map(id => ({ type: 'ticket_comment' as const, id })));
      expect(sorted(verified.map(r => r.id))).toEqual(sorted([sharedNote, requesterComment]));
    });

    it('a row indexed before the audience was carried is hidden from a seat technician', async () => {
      const where = { tenant, object_type: 'ticket_comment', object_id: sharedNote };
      const before = await knex('app_search_index').where(where).first('metadata');
      await knex('app_search_index').where(where).update({ metadata: knex.raw(`metadata - 'audience'`) });
      try {
        expect((await searchHits(await searchPrincipal(seatUser))).map(h => h.id)).toEqual([requesterComment]);
        expect((await searchHits(await searchPrincipal(mspUser))).map(h => h.id)).toContain(sharedNote);
      } finally {
        await knex('app_search_index').where(where).update({ metadata: before.metadata });
      }
    });

    it('a seat user whose arrangement has ended reads no comment at all', async () => {
      await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).update({ state: 'ended', ended_at: new Date() });
      try {
        expect(await resolveCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal' })).toBeNull();
        expect(onlyMine((await Comment.getAllbyTicketId(knex, tenant, ticketId, seatUser)).map(c => c.comment_id))).toEqual([]);
        expect(await canReadCommentAttachment(knex, tenant, seatUser, attachments.get(requesterComment)!)).toBe(false);
        const rows = (await readTicketActivity(knex, tenant, ticketId, { internalReaderId: seatUser })).filter(row => auditIds.includes(row.audit_id));
        expect(rows.some(row => row.entity_type === 'comment')).toBe(false);
        const acl = await searchPrincipal(seatUser);
        expect(await searchHits(acl)).toEqual([]);
        expect(await verifyResultVisibility(knex, acl, mine().map(id => ({ type: 'ticket_comment' as const, id })))).toEqual([]);
      } finally {
        await t('co_managed_seat_arrangements').where({ arrangement_id: arrangementId }).update({ state: 'active', ended_at: null });
      }
    });
  });

  describe('MSP staff read exactly what they read before', () => {
    it('every note in the conversation, with and without a named reader', async () => {
      const unfiltered = await Comment.getAllbyTicketId(knex, tenant, ticketId);
      const asStaff = await Comment.getAllbyTicketId(knex, tenant, ticketId, mspUser);
      expect(asStaff.map(c => c.comment_id)).toEqual(unfiltered.map(c => c.comment_id));
      expect(onlyMine(asStaff.map(c => c.comment_id))).toEqual(sorted(mine()));
    });

    it('every activity row, including one about a deleted comment', async () => {
      const unfiltered = await readTicketActivity(knex, tenant, ticketId);
      const asStaff = await readTicketActivity(knex, tenant, ticketId, { internalReaderId: mspUser });
      expect(asStaff.map(row => row.audit_id)).toEqual(unfiltered.map(row => row.audit_id));
      expect(auditIds.every(id => asStaff.some(row => row.audit_id === id))).toBe(true);
      const timeline = await buildUnifiedTicketTimeline(knex, tenant, ticketId, { internalReaderId: mspUser });
      expect(timeline).toHaveLength((await buildUnifiedTicketTimeline(knex, tenant, ticketId)).length);
    });

    it('every attachment', async () => {
      for (const documentId of attachments.values()) expect(await canReadCommentAttachment(knex, tenant, mspUser, documentId)).toBe(true);
    });

    it('every note in search', async () => {
      const acl = await searchPrincipal(mspUser);
      expect(acl.audienceReader).toEqual({ kind: 'staff', tenant });
      expect(sorted((await searchHits(acl)).map(h => h.id))).toEqual(sorted(mine()));
      const verified = await verifyResultVisibility(knex, acl, mine().map(id => ({ type: 'ticket_comment' as const, id })));
      expect(verified).toHaveLength(mine().length);
    });
  });

  /**
   * A comment saved before attachment rows existed owns its inline image only through the upload
   * URL in its note: the document is associated with the ticket and has no
   * `ticket_comment_attachments` row. The parent's audience still decides the file bytes gate, the
   * document list and the document's activity event for a seat technician.
   */
  describe('documents owned only by the upload URL in a comment note', () => {
    const legacyAudit: string[] = [];
    const legacyComments: string[] = [];
    const documents: Record<'private' | 'shared' | 'both' | 'standalone', string> = {
      private: randomUUID(), shared: randomUUID(), both: randomUUID(), standalone: randomUUID(),
    };
    const files = new Map<string, string>();
    const all = () => Object.values(documents);
    const inlineImage = (text: string, ...fileIds: string[]) => JSON.stringify([
      { id: randomUUID(), type: 'paragraph', props: {}, content: [{ type: 'text', text, styles: {} }], children: [] },
      ...fileIds.map(fileId => ({ id: randomUUID(), type: 'image', props: { url: `/api/documents/view/${fileId}`, name: 'legacy.png' }, children: [] })),
    ]);

    beforeAll(async () => {
      for (const documentId of all()) {
        const fileId = randomUUID();
        files.set(documentId, fileId);
        await t('external_files').insert({ tenant, file_id: fileId, file_name: `${TERM}.png`, original_name: `${TERM}.png`,
          mime_type: 'image/png', file_size: 1, storage_path: `${TERM}/${fileId}`, uploaded_by_id: mspUser });
        await t('documents').insert({ tenant, document_id: documentId, document_name: `${TERM}-legacy.png`, file_id: fileId, user_id: mspUser, created_by: mspUser });
        await t('document_associations').insert({ tenant, document_id: documentId, entity_id: ticketId, entity_type: 'ticket' });
      }
      const file = (key: keyof typeof documents) => files.get(documents[key])!;
      legacyComments.push(await comment({ is_internal: true, note: inlineImage(`${TERM} legacy private image`, file('private'), file('both')) }));
      legacyComments.push(await comment({ is_internal: true, collaboration_audience: 'shared_it', note: inlineImage(`${TERM} legacy shared image`, file('shared'), file('both')) }));
      // Saving a comment today claims its uploads; the legacy state is the same rows without the claim.
      await t('ticket_comment_attachments').whereIn('document_id', all()).delete();
      for (const documentId of all()) await activity('TICKET_DOCUMENT_ATTACHED', 'document', documentId, legacyAudit);
    }, 120_000);

    afterAll(async () => {
      if (!tenant) return;
      await t('ticket_audit_logs').whereIn('audit_id', legacyAudit).delete().catch(() => undefined);
      await t('ticket_comment_attachments').whereIn('document_id', all()).delete().catch(() => undefined);
      await t('document_associations').whereIn('document_id', all()).delete().catch(() => undefined);
      await t('documents').whereIn('document_id', all()).delete().catch(() => undefined);
      await t('external_files').whereIn('file_id', [...files.values()]).delete().catch(() => undefined);
      for (const id of legacyComments) {
        const c = await t('comments').where({ comment_id: id }).first('thread_id');
        if (!c) continue;
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
        await t('comments').where({ comment_id: id }).delete().catch(() => undefined);
        await t('comment_threads').where({ thread_id: c.thread_id }).delete().catch(() => undefined);
      }
    });

    /** What one reader gets of the four documents on each surface. */
    async function surfaces(userId: string) {
      const bytes: string[] = [];
      for (const documentId of all()) if (await canReadCommentAttachment(knex, tenant, userId, documentId)) bytes.push(documentId);
      const listed = await filterReadableCommentAttachments(knex, tenant, userId, all().map(document_id => ({ document_id })));
      const events = (await readTicketActivity(knex, tenant, ticketId, { internalReaderId: userId })).filter(row => legacyAudit.includes(row.audit_id));
      const timeline = (await buildUnifiedTicketTimeline(knex, tenant, ticketId, { internalReaderId: userId }))
        .filter(e => e.type === 'activity' && all().includes(e.activity?.entity_id ?? ''));
      return {
        bytes: sorted(bytes), listed: sorted(listed.map(d => d.document_id)),
        events: sorted(events.map(row => row.entity_id as string)), timeline: sorted(timeline.map(e => e.activity?.entity_id as string)),
      };
    }

    it('the fixture is the legacy state: associated with the ticket, named in a note, no attachment row', async () => {
      expect(await t('ticket_comment_attachments').whereIn('document_id', all())).toHaveLength(0);
      expect(await t('document_associations').whereIn('document_id', all()).where({ entity_type: 'ticket', entity_id: ticketId })).toHaveLength(4);
      const [privateNote] = legacyComments;
      expect((await t('comments').where({ comment_id: privateNote }).first('note')).note).toContain(`/api/documents/view/${files.get(documents.private)}`);
      expect(await Comment.get(knex, tenant, privateNote, seatUser)).toBeUndefined();
    });

    it('a seat technician gets the shared image and the standalone document, never the private image', async () => {
      const visible = sorted([documents.shared, documents.standalone]);
      // `both` is named by the private note too: every owner must be visible.
      expect(await surfaces(seatUser)).toEqual({ bytes: visible, listed: visible, events: visible, timeline: visible });
    });

    it('MSP staff get all four on every surface', async () => {
      const everything = sorted(all());
      expect(await surfaces(mspUser)).toEqual({ bytes: everything, listed: everything, events: everything, timeline: everything });
    });

    it('a private note that only mentions another file id leaves the standalone document alone', async () => {
      // The owner is found by the upload URL, not by any text that happens to contain the id.
      const mention = await comment({ is_internal: true, note: inlineImage(`${TERM} see file ${files.get(documents.standalone)} and https://example.test/view/${files.get(documents.standalone)}`) });
      legacyComments.push(mention);
      expect(await canReadCommentAttachment(knex, tenant, seatUser, documents.standalone)).toBe(true);
    });

    it('a mapped attachment of a shared note is still hidden when a private note also names its file', async () => {
      const documentId = attachments.get(sharedNote)!;
      const fileId = randomUUID();
      await t('external_files').insert({ tenant, file_id: fileId, file_name: `${TERM}.png`, original_name: `${TERM}.png`,
        mime_type: 'image/png', file_size: 1, storage_path: `${TERM}/${fileId}`, uploaded_by_id: mspUser });
      files.set(`mapped:${documentId}`, fileId);
      await t('documents').where({ document_id: documentId }).update({ file_id: fileId });
      await t('document_associations').insert({ tenant, document_id: documentId, entity_id: ticketId, entity_type: 'ticket' });
      try {
        expect(await canReadCommentAttachment(knex, tenant, seatUser, documentId)).toBe(true);
        // Written straight to the row: saving such a note today is refused, a legacy row just has it.
        const note = await comment({ is_internal: true, note: inlineImage(`${TERM} legacy private reuse`) });
        legacyComments.push(note);
        await t('comments').where({ comment_id: note }).update({ note: inlineImage(`${TERM} legacy private reuse`, fileId) });
        expect(await canReadCommentAttachment(knex, tenant, seatUser, documentId)).toBe(false);
        expect(await canReadCommentAttachment(knex, tenant, mspUser, documentId)).toBe(true);
        await t('comments').where({ comment_id: note }).update({ note: inlineImage(`${TERM} legacy private reuse`) });
        expect(await canReadCommentAttachment(knex, tenant, seatUser, documentId)).toBe(true);
      } finally {
        await t('document_associations').where({ document_id: documentId }).delete();
        await t('documents').where({ document_id: documentId }).update({ file_id: null });
      }
    });
  });

  it('the in-statement reader agrees with the resolver and the TypeScript predicate on every row', async () => {
    const rows = await tenantDb(knex, tenant).table('comments as c')
      .join('comment_threads as th', function () { this.on('th.thread_id', 'c.thread_id').andOn('th.tenant', 'c.tenant'); })
      .join('comments as root', function () { this.on('root.comment_id', 'th.root_comment_id').andOn('root.tenant', 'th.tenant'); })
      .where('c.ticket_id', ticketId).where('c.tenant', tenant)
      .select('c.comment_id', 'th.collaboration_audience', 'th.is_internal', 'root.is_internal as root_is_internal', 'c.is_internal as comment_is_internal');
    for (const userId of [mspUser, seatUser]) {
      const reader = await resolveCommentAudienceReader(knex, tenant, { userId, userType: 'internal' });
      const expected = rows.filter(row => isCommentAudienceVisible(resolveCommentAudienceForRead(row), { tenant, clientId }, reader)).map(row => row.comment_id);
      const actual = (await Comment.getAllbyTicketId(knex, tenant, ticketId, userId)).map(c => c.comment_id as string);
      expect(sorted(actual)).toEqual(sorted(expected));
    }
  });
});
