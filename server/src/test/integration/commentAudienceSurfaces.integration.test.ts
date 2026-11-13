import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Knex } from 'knex';
import { runWithTenant, tenantDb } from '@alga-psa/db';
import { randomUUID } from 'node:crypto';
import {
  admitCommentAudienceReader, isCommentAudienceVisible, resolveCommentAudienceForRead, resolveCommentAudienceReader,
  type CommentAudienceReader,
} from '@alga-psa/shared/lib/commentAudience';
import { registerCapabilityParticipation, serves } from '@alga-psa/core/capability';
import { clearCapabilityCache, resetCapabilityRegistry } from '@alga-psa/core/capability/testing';
import { coManagedParticipants } from '@alga-psa/co-managed/capability';
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
 * invitation command is on main. Who is staff is decided by the seat tables, or with no SQL by
 * `users.seat_reader` on a loaded user row; never by the co-managed capability gate. The tenant
 * still holds an entitlement row and the process registers the production participation
 * resolver, so the cases below can put the gate in every state and show it changes nothing.
 */
type LoadedUser = { user_id: string; user_type: string; tenant: string; seat_reader?: boolean };

describe('comment audience in attachments, activity and search (integration)', () => {
  let knex: Knex;
  let tenant: string;
  let ticketId: string;
  let clientId: string;
  let mspUser: string;
  let seatUser: string;
  let arrangementId: string;
  /** True when this file wrote the tenant's entitlement row and must remove it. */
  let entitlementAdded = false;
  const participation = () => registerCapabilityParticipation('co-managed', ({ tenantIds }) => coManagedParticipants(tenantIds, knex));
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

  /** `reader`: a user id (the principal is resolved from the seat tables) or the loaded user row. */
  async function searchPrincipal(reader: string | LoadedUser): Promise<SearchAclPrincipal> {
    const user = typeof reader === 'string' ? { user_id: reader, user_type: 'internal', tenant } : reader;
    const principal = await runWithTenant(tenant, () => resolveSearchAclPrincipal(knex, user as any, { mode: 'all' }));
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

    if (!await t('co_managed_entitlements').first('tenant')) {
      await t('co_managed_entitlements').insert({ tenant, source: 'hosted', source_reference: `sub_${randomUUID()}`, capacity: 1,
        verified_at: new Date(Date.now() - 86_400_000), valid_until: new Date(Date.now() + 365 * 86_400_000) });
      entitlementAdded = true;
    }
    delete process.env.FORCE_CAPABILITIES;
    participation();
    expect((await serves('co-managed', tenant)).reasons.served).toBe('open');

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
      if (entitlementAdded) await t('co_managed_entitlements').delete().catch(() => undefined);
    }
    resetCapabilityRegistry();
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

  describe('who is read as staff', () => {
    /** Every statement `run` sends, as SQL text. */
    async function statements(run: () => Promise<unknown>): Promise<string[]> {
      const seen: string[] = [];
      const listen = (query: { sql: string }) => { seen.push(query.sql); };
      knex.on('query', listen);
      try { await run(); } finally { knex.removeListener('query', listen); }
      return seen;
    }
    /** The user row as a request loads it (`getUserWithRoles` selects every column). */
    const loaded = async (userId: string): Promise<LoadedUser> => (await t('users').where({ user_id: userId }).first()) as LoadedUser;
    const readEverySurface = (reader: string | LoadedUser) => async () => {
      await Comment.getAllbyTicketId(knex, tenant, ticketId, reader);
      await Comment.get(knex, tenant, sharedNote, reader);
      await buildUnifiedTicketTimeline(knex, tenant, ticketId, { internalReaderId: reader });
      await canReadCommentAttachment(knex, tenant, reader, attachments.get(sharedNote)!);
      await canReadCommentAttachment(knex, tenant, reader, plainDocumentId);
      await searchPrincipal(reader);
    };
    /** What one reader gets on each of the four surfaces, over this file's rows. */
    const surfaces = async (reader: string | LoadedUser) => ({
      comments: onlyMine((await Comment.getAllbyTicketId(knex, tenant, ticketId, reader)).map(c => c.comment_id)),
      privateAttachmentReadable: await canReadCommentAttachment(knex, tenant, reader, attachments.get(privateNotes[0])!),
      sharedAttachmentReadable: await canReadCommentAttachment(knex, tenant, reader, attachments.get(sharedNote)!),
      privateActivityEvents: (await readTicketActivity(knex, tenant, ticketId, { internalReaderId: reader }))
        .filter(row => privateNotes.includes(row.entity_id as string)).length,
      searchHits: sorted((await searchHits(await searchPrincipal(reader))).map(h => h.id)),
    });
    const seatSurfaces = () => ({
      comments: sorted([sharedNote, requesterComment]), privateAttachmentReadable: false, sharedAttachmentReadable: true,
      privateActivityEvents: 0, searchHits: sorted([sharedNote, requesterComment]),
    });
    const staffSurfaces = () => ({
      comments: sorted(mine()), privateAttachmentReadable: true, sharedAttachmentReadable: true,
      privateActivityEvents: 11, searchHits: sorted(mine()),
    });
    /** The seat technician, named by id and by loaded row, reads only its audiences on every surface. */
    const seatReadsOnlyItsAudiences = async () => {
      expect(await surfaces(seatUser)).toEqual(seatSurfaces());
      expect(await surfaces(await loaded(seatUser))).toEqual(seatSurfaces());
    };
    const restore = () => { delete process.env.FORCE_CAPABILITIES; participation(); clearCapabilityCache(); };

    it('a loaded staff row reads every surface in full with no seat table in any statement', async () => {
      const staff = await loaded(mspUser);
      expect(staff.seat_reader).toBe(false);
      expect(await admitCommentAudienceReader(knex, tenant, { userId: mspUser, userType: 'internal', seatReader: staff.seat_reader })).toEqual({ kind: 'staff', tenant });
      const sql = await statements(readEverySurface(staff));
      expect(sql.length).toBeGreaterThan(0);
      expect(sql.filter(text => /co_managed_/.test(text))).toEqual([]);
      expect(await surfaces(staff)).toEqual(staffSurfaces());
    });

    it('a bare user id is never presumed staff: the statement asks the seat tables', async () => {
      expect((await statements(readEverySurface(mspUser))).some(text => /co_managed_seat_assignments/.test(text))).toBe(true);
      expect(await surfaces(mspUser)).toEqual(staffSurfaces());
      // A row loaded without the marker says nothing either, and is checked the same way.
      const { seat_reader: _unknown, ...unmarked } = await loaded(mspUser);
      expect((await statements(readEverySurface(unmarked))).some(text => /co_managed_seat_assignments/.test(text))).toBe(true);
    });

    it('the seat technician is filtered whether named by id or by loaded row', async () => {
      expect((await loaded(seatUser)).seat_reader).toBe(true);
      expect(await admitCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal', seatReader: true })).toEqual({ kind: 'seat', tenant, clientId });
      expect(await admitCommentAudienceReader(knex, tenant, { userId: seatUser, userType: 'internal' })).toEqual({ kind: 'seat', tenant, clientId });
      await seatReadsOnlyItsAudiences();
    });

    it.each<[string, () => void, string]>([
      ['never registered', () => registerCapabilityParticipation('co-managed', null), 'resolver-unregistered'],
      ['whose participation read fails', () => registerCapabilityParticipation('co-managed', async () => { throw new Error('participation read failed'); }), 'participation-error'],
      ['forced off', () => { process.env.FORCE_CAPABILITIES = 'co-managed:off'; }, 'forced-off'],
      ['forced on', () => { process.env.FORCE_CAPABILITIES = 'co-managed:on'; }, 'forced-on'],
      ['forced to a malformed value', () => { process.env.FORCE_CAPABILITIES = 'co-managed:sideways'; }, 'forced-malformed'],
    ])('a co-managed capability %s changes nothing for a seat technician or for staff', async (_name, arrange, reason) => {
      arrange();
      clearCapabilityCache();
      try {
        expect((await serves('co-managed', tenant)).reasons.served).toBe(reason);
        await seatReadsOnlyItsAudiences();
        const staff = await loaded(mspUser);
        expect(await surfaces(staff)).toEqual(staffSurfaces());
        expect((await statements(readEverySurface(staff))).filter(text => /co_managed_/.test(text))).toEqual([]);
      } finally { restore(); }
    });

    it('a seat bound just after the capability gate cached "not participating" is filtered on the next read', async () => {
      const entitlement = await t('co_managed_entitlements').first();
      const assignment = { arrangement_id: arrangementId, user_id: seatUser };
      await t('co_managed_seat_assignments').where(assignment).update({ state: 'revoked', revoked_at: new Date() });
      await t('co_managed_entitlements').delete();
      clearCapabilityCache();
      try {
        // The gate reads the tenant before its first entitlement row and caches the negative.
        expect((await serves('co-managed', tenant)).reasons.served).toBe('not-participating');
        expect(await surfaces(await loaded(seatUser))).toEqual(staffSurfaces());

        await t('co_managed_entitlements').insert(entitlement);
        await t('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), ...assignment, state: 'active' });
        // Still cached, and it does not matter.
        expect((await serves('co-managed', tenant)).reasons.served).toBe('not-participating');
        await seatReadsOnlyItsAudiences();
      } finally {
        if (!await t('co_managed_entitlements').first('tenant')) await t('co_managed_entitlements').insert(entitlement);
        if (!await t('co_managed_seat_assignments').where(assignment).whereNot('state', 'revoked').first('assignment_id')) {
          await t('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), ...assignment, state: 'active' });
        }
        restore();
      }
    });

    it('a seat user whose assignment is not yet active reads nothing, on every surface', async () => {
      await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId, user_id: seatUser }).whereNot('state', 'revoked').update({ state: 'invited' });
      try {
        for (const reader of [seatUser, await loaded(seatUser)]) {
          expect(await searchPrincipal(reader)).toMatchObject({ audienceReader: null });
          expect(onlyMine((await Comment.getAllbyTicketId(knex, tenant, ticketId, reader)).map(c => c.comment_id))).toEqual([]);
          expect(await canReadCommentAttachment(knex, tenant, reader, attachments.get(requesterComment)!)).toBe(false);
          const rows = (await readTicketActivity(knex, tenant, ticketId, { internalReaderId: reader })).filter(row => auditIds.includes(row.audit_id));
          expect(rows.some(row => row.entity_type === 'comment')).toBe(false);
          expect(await searchHits(await searchPrincipal(reader))).toEqual([]);
        }
      } finally {
        await t('co_managed_seat_assignments').where({ arrangement_id: arrangementId, user_id: seatUser }).whereNot('state', 'revoked').update({ state: 'active' });
      }
    });

    describe('the users.seat_reader marker', () => {
      const marker = async (userId: string) => (await loaded(userId)).seat_reader;
      const live = () => t('co_managed_seat_assignments').where({ arrangement_id: arrangementId, user_id: seatUser }).whereNot('state', 'revoked');

      it('cannot say "not bound" while an assignment binds the user: the foreign key refuses it', async () => {
        expect(await marker(seatUser)).toBe(true);
        await expect(t('users').where({ user_id: seatUser }).update({ seat_reader: false }))
          .rejects.toMatchObject({ code: '23503', constraint: 'co_managed_seat_assignments_seat_reader_foreign' });
        expect(await marker(seatUser)).toBe(true);
      });

      it('an invited assignment that names no user binds nobody', async () => {
        const assignmentId = randomUUID();
        await t('co_managed_seat_assignments').insert({ tenant, assignment_id: assignmentId, arrangement_id: arrangementId, state: 'invited' });
        try {
          expect((await t('co_managed_seat_assignments').where({ assignment_id: assignmentId }).first('binds_seat_reader')).binds_seat_reader).toBeNull();
        } finally {
          await t('co_managed_seat_assignments').where({ assignment_id: assignmentId }).delete();
        }
      });

      it('where no trigger runs (Citus), binding an unmarked user is refused until the command marks them', async () => {
        const rollback = new Error('rollback');
        await expect(knex.transaction(async (trx) => {
          const tt = (table: string) => tenantDb(trx, tenant).table(table);
          await trx.raw('ALTER TABLE co_managed_seat_assignments DISABLE TRIGGER co_managed_seat_assignment_marks_reader');
          const binding = { tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: mspUser, state: 'active' };
          await trx.raw('SAVEPOINT unmarked');
          await expect(tt('co_managed_seat_assignments').insert(binding))
            .rejects.toMatchObject({ code: '23503', constraint: 'co_managed_seat_assignments_seat_reader_foreign' });
          await trx.raw('ROLLBACK TO SAVEPOINT unmarked');
          await tt('users').where({ user_id: mspUser }).update({ seat_reader: true });
          await tt('co_managed_seat_assignments').insert(binding);
          throw rollback;
        })).rejects.toBe(rollback);
        expect(await marker(mspUser)).toBe(false);
      });

      // Plain Postgres keeps the marker in step by trigger; on Citus the binding command does.
      it('follows an assignment written directly: set when it binds, cleared when the last one is revoked or deleted', async () => {
        expect(await marker(mspUser)).toBe(false);
        await live().update({ state: 'revoked', revoked_at: new Date() });
        try {
          expect(await marker(seatUser)).toBe(false);
          expect(await surfaces(await loaded(seatUser))).toEqual(staffSurfaces());

          const assignmentId = randomUUID();
          await t('co_managed_seat_assignments').insert({ tenant, assignment_id: assignmentId, arrangement_id: arrangementId, user_id: seatUser, state: 'invited' });
          expect(await marker(seatUser)).toBe(true);
          await t('co_managed_seat_assignments').where({ assignment_id: assignmentId }).delete();
          expect(await marker(seatUser)).toBe(false);
        } finally {
          if (!await live().first('assignment_id')) {
            await t('co_managed_seat_assignments').insert({ tenant, assignment_id: randomUUID(), arrangement_id: arrangementId, user_id: seatUser, state: 'active' });
          }
        }
        expect(await marker(seatUser)).toBe(true);
        await seatReadsOnlyItsAudiences();
      });
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
