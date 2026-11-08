import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, getTenantContext } from '@alga-psa/db';
import * as dbModule from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { NextRequest } from 'next/server';

const routeSession = vi.hoisted(() => ({ user: null as any, permitted: true, documentsPermitted: true }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => routeSession.user }));
vi.mock('@alga-psa/auth', async importOriginal => ({ ...await importOriginal<typeof import('@alga-psa/auth')>(),
  withAuth: (fn: any) => (...args: any[]) => fn(routeSession.user, { tenant: routeSession.user?.tenant }, ...args),
  hasPermission: async (_user: unknown, resource: string) => routeSession.permitted && (resource !== 'document' || routeSession.documentsPermitted),
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) => checks.map(check =>
    ({ ...check, granted: routeSession.permitted && (check.resource !== 'document' || routeSession.documentsPermitted) })),
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string) => routeSession.permitted && (resource !== 'document' || routeSession.documentsPermitted),
  checkMultiplePermissions: async (_user: unknown, checks: { resource: string; action: string }[]) => checks.map(check =>
    ({ ...check, granted: routeSession.permitted && (check.resource !== 'document' || routeSession.documentsPermitted) })),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => routeSession.permitted }));
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import {
  canReadCommentAttachment, canWriteAttachmentTicket, canAccessAttachmentTicket, reconcileCommentAttachments, expireCommentAttachmentDrafts,
  listPublishedCommentAttachments, filterReadableCommentAttachments, dispatchCommentPublication, persistCommentPublication,
} from '@shared/lib/ticketCommentAttachments';
import { signAttachmentLink, verifyAttachmentLink } from '@shared/lib/ticketCommentAttachmentToken';
import {
  prepareCommentAttachmentEmail, claimCommentEmailDelivery, finishCommentEmailDelivery, attachmentSigningSecret,
} from '@/lib/notifications/ticketCommentAttachmentEmail';
import { getAuthorizedDocumentById, getAuthorizedDocumentByFileId } from '@alga-psa/documents/actions/documentActions';
import { TicketModel } from '@shared/models/ticketModel';
import Comment from '@alga-psa/tickets/models/comment';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';

// Required migrated-database coverage; each ordinary fixture rolls back.
describe('ticket comment attachments (migrated PostgreSQL)', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, actor: string, clientUser: string, otherUser: string, client: string, ticket: string, comment: string;
  const table = (name: string) => tenantDb(trx, tenant).table(name);
  const recipient = 'attachment-recipient@example.test';
  beforeAll(async () => {
    conn = await createTestDbConnection();
  });
  afterAll(async () => { await conn?.destroy(); });
  beforeEach(async () => {
    trx = await conn.transaction();
    tenant = randomUUID(); actor = randomUUID(); clientUser = randomUUID(); otherUser = randomUUID(); client = randomUUID(); ticket = randomUUID();
    await tenantDb(trx, tenant).unscoped('tenants', 'create isolated test tenant').insert({ tenant, client_name:'Attachment tests', email:'tenant@example.test', product_code:'psa' });
    const otherClient = randomUUID(), contact = randomUUID(), otherContact = randomUUID();
    await table('clients').insert([{tenant,client_id:client,client_name:'A'},{tenant,client_id:otherClient,client_name:'B'}]);
    await table('contacts').insert([{tenant,contact_name_id:contact,client_id:client,full_name:'Recipient',email:recipient},{tenant,contact_name_id:otherContact,client_id:otherClient,full_name:'Other',email:'other@example.test'}]);
    await table('users').insert([
      {tenant,user_id:actor,username:actor,email:'agent@example.test',hashed_password:'unused',user_type:'internal',is_inactive:false},
      {tenant,user_id:clientUser,username:clientUser,email:recipient,hashed_password:'unused',user_type:'client',contact_id:contact,is_inactive:false},
      {tenant,user_id:otherUser,username:otherUser,email:'other@example.test',hashed_password:'unused',user_type:'client',contact_id:otherContact,is_inactive:false},
    ]);
    await table('tickets').insert({tenant,ticket_id:ticket,ticket_number:'ATT-1',client_id:client,title:'Attachment tests',entered_by:actor});
    comment = await makeComment();
  });
  afterEach(async () => { await trx?.rollback(); });
  async function makeComment(overrides: Record<string, unknown> = {}) {
    const id = randomUUID(), thread = randomUUID();
    await table('comment_threads').insert({tenant,thread_id:thread,ticket_id:ticket,root_comment_id:id,is_internal:false,created_by:actor});
    await table('comments').insert({tenant,comment_id:id,thread_id:thread,ticket_id:ticket,user_id:actor,author_type:'internal',note:'[]',is_internal:false,is_resolution:false,...overrides});
    return id;
  }
  async function upload(name = 'report.pdf', mime = 'application/pdf', size = 12, owner = actor) {
    const document = randomUUID(), file = randomUUID();
    await table('external_files').insert({tenant,file_id:file,file_name:name,original_name:name,mime_type:mime,file_size:size,storage_path:`/test/${file}`,uploaded_by_id:owner});
    await table('documents').insert({tenant,document_id:document,file_id:file,document_name:name,mime_type:mime,file_size:size,user_id:owner,created_by:owner,is_client_visible:true});
    await table('document_associations').insert({tenant,document_id:document,entity_type:'ticket',entity_id:ticket});
    await table('ticket_comment_attachments').insert({tenant,document_id:document,ticket_id:ticket,created_by:owner,expires_at:new Date(Date.now()+86400000)});
    return {document,file};
  }
  function note(...files: string[]) {
    return JSON.stringify(files.map(file => ({type:'file',props:{url:`/api/documents/download/${file}`,name:'report.pdf'}})));
  }
  async function attach(file: string, id = comment, user = actor) {
    await table('comments').where({comment_id:id}).update({note:note(file)});
    await reconcileCommentAttachments(trx, tenant, id, user);
  }
  it('loads authorized attachment metadata and membership through the actual optimized ticket path', async () => {
    const { getConsolidatedTicketData } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    const { getDocumentByTicketId, getDocumentsByEntity, getDocumentCountsForEntities } = await import('@alga-psa/documents/actions/documentActions');
    const connection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    routeSession.user = { ...await table('users').where({ user_id: actor }).first(), tenant };
    try {
      const publicFile = await upload('public.pdf');
      await attach(publicFile.file);
      const internalFile = await upload('internal.pdf');
      await attach(internalFile.file, await makeComment({ is_internal: true }));
      const removed = await upload('00-removed.pdf');
      await table('ticket_comment_attachments').where({ document_id: removed.document }).update({ state: 'removed' });
      const standalone = await upload('standalone.pdf');
      await table('ticket_comment_attachments').where({ document_id: standalone.document }).delete();
      const draft = await upload('active-draft.pdf');
      await upload('other-user-draft.pdf', 'application/pdf', 12, clientUser);
      const expired = await upload('expired-draft.pdf');
      await table('ticket_comment_attachments').where({ document_id: expired.document }).update({ expires_at: new Date(0) });

      const initial = await getConsolidatedTicketData(ticket);
      const expectedIds = [publicFile.document, internalFile.document, standalone.document, draft.document];
      expect(initial.documents).toHaveLength(4);
      expect(initial.documents.map((d: any) => d.document_id).sort()).toEqual(expectedIds.sort());
      expect(initial.documents.find((d: any) => d.document_id === internalFile.document)).toMatchObject({ is_client_visible: true, comment_attachment_is_public: false });
      expect(initial.documents.find((d: any) => d.document_id === publicFile.document)).toMatchObject({ comment_attachment_is_public: true });
      expect(initial.documents.find((d: any) => d.document_id === draft.document)).toMatchObject({ comment_attachment_is_public: false });
      expect(initial.documents.find((d: any) => d.document_id === standalone.document)).not.toHaveProperty('comment_attachment_is_public');
      expect((await getDocumentCountsForEntities([ticket], 'ticket')).get(ticket)).toBe(initial.documents.length);
      const subsequent = await getDocumentByTicketId(ticket) as any[];
      expect(subsequent.map(d => d.document_id).sort()).toEqual(expectedIds);
      // Removed rows sort first, but must never consume a page slot or inflate totals.
      const pages = await Promise.all([1, 2].map(page => getDocumentsByEntity(ticket, 'ticket', { sortBy: 'document_name', sortOrder: 'asc' }, page, 2))) as any[];
      expect(pages.map(p => p.totalCount)).toEqual([4, 4]);
      expect(pages.map(p => p.totalPages)).toEqual([2, 2]);
      expect(pages.flatMap(p => p.documents.map((d: any) => d.document_id)).sort()).toEqual(expectedIds);

      // The same document ID transitions from owned draft to public, then internal.
      await attach(draft.file, await makeComment());
      expect((await getConsolidatedTicketData(ticket)).documents.find((d: any) => d.document_id === draft.document)).toMatchObject({ comment_attachment_is_public: true });
      const claimed = await table('ticket_comment_attachments').where({ document_id: draft.document }).first();
      await Comment.update(trx, tenant, claimed.comment_id, { is_internal: true }, actor);
      expect((await getConsolidatedTicketData(ticket)).documents.find((d: any) => d.document_id === draft.document)).toMatchObject({ comment_attachment_is_public: false });

      routeSession.documentsPermitted = false;
      expect((await getConsolidatedTicketData(ticket)).documents).toEqual([]);
      expect((await getDocumentCountsForEntities([ticket], 'ticket')).get(ticket)).toBe(0);
    } finally { routeSession.documentsPermitted = true; connection.mockRestore(); }
  });

  it('excludes unauthorized client and tenant documents from the optimized initial load and totals', async () => {
    const { getConsolidatedTicketData } = await import('@alga-psa/tickets/actions/optimizedTicketActions');
    const { getDocumentsByEntity, getDocumentCountsForEntities } = await import('@alga-psa/documents/actions/documentActions');
    const connection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    const pdf = await upload();
    await attach(pdf.file);
    const standalone = await upload('standalone.pdf');
    await table('ticket_comment_attachments').where({ document_id: standalone.document }).delete();
    try {
      for (const user of [
        { ...await table('users').where({ user_id: otherUser }).first(), clientId: (await table('contacts').where({ email: 'other@example.test' }).first()).client_id },
        { ...await table('users').where({ user_id: actor }).first(), tenant: randomUUID() },
      ]) {
        routeSession.user = user;
        const initial = await getConsolidatedTicketData(ticket);
        expect(initial.documents ?? []).toEqual([]);
        expect((await getDocumentsByEntity(ticket, 'ticket', undefined, 1, 1) as any)).toMatchObject({ documents: [], totalCount: 0 });
        expect((await getDocumentCountsForEntities([ticket], 'ticket')).get(ticket)).toBe(0);
      }
    } finally { connection.mockRestore(); }
  });
  it('withdraws only authorized actor-owned drafts and preserves published/shared documents', async () => {
    const { discardCommentAttachmentDrafts } = await import('@alga-psa/tickets/actions/comment-actions/commentAttachmentDraftActions');
    const connection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    const draft = await upload(), published = await upload(), other = await upload('other.pdf', 'application/pdf', 12, clientUser);
    const additionalDrafts: Array<Awaited<ReturnType<typeof upload>>> = [];
    for (let index = 0; index < 100; index++) additionalDrafts.push(await upload());
    await attach(published.file);
    routeSession.user = { ...await table('users').where({ user_id: actor }).first(), tenant };
    try {
      routeSession.permitted = false;
      await expect(discardCommentAttachmentDrafts({ ticketId: ticket, documentIds: [draft.document] })).rejects.toThrow('Permission denied');
      expect((await table('ticket_comment_attachments').where({ document_id: draft.document }).first()).state).toBe('draft');
      routeSession.permitted = true;
      routeSession.user = { ...await table('users').where({ user_id: otherUser }).first(), tenant };
      await expect(discardCommentAttachmentDrafts({ ticketId: ticket, documentIds: [draft.document] })).rejects.toThrow('Permission denied');
      routeSession.user = { ...await table('users').where({ user_id: actor }).first(), tenant };
      const ownedDraftIds = [draft.document, ...additionalDrafts.map(row => row.document)];
      const result = await discardCommentAttachmentDrafts({ ticketId: ticket, documentIds: [...ownedDraftIds, published.document, other.document] });
      expect(new Set(result.deletedDocumentIds)).toEqual(new Set(ownedDraftIds));
      expect((await table('ticket_comment_attachments').where({ document_id: published.document }).first()).state).toBe('attached');
      expect((await table('ticket_comment_attachments').where({ document_id: other.document }).first()).state).toBe('draft');
      expect(await table('documents').where({ document_id: draft.document }).first()).toBeTruthy();
      expect(await table('document_associations').where({ document_id: draft.document }).first()).toBeTruthy();
    } finally { routeSession.permitted = true; connection.mockRestore(); }
  });
  it('returns effective attachment visibility without changing the document setting', async () => {
    const { document, file } = await upload();
    const user = { ...await table('users').where({ user_id: actor }).first(), tenant };
    routeSession.permitted = true;
    expect(await getAuthorizedDocumentById(trx, tenant, user, document)).toMatchObject({ is_client_visible: true, comment_attachment_is_public: false });
    await attach(file);
    expect(await getAuthorizedDocumentById(trx, tenant, user, document)).toMatchObject({ comment_attachment_is_public: true });
    await table('comments').where({ comment_id: comment }).update({ is_internal: true });
    expect(await getAuthorizedDocumentById(trx, tenant, user, document)).toMatchObject({ is_client_visible: true, comment_attachment_is_public: false });
    expect((await table('documents').where({ document_id: document }).first()).is_client_visible).toBe(true);
  });
  it('claims a public PDF to the exact comment; ticket Documents association remains', async () => {
    const {document,file} = await upload();
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(false);
    await attach(file);
    expect(await table('ticket_comment_attachments').where({document_id:document}).first()).toMatchObject({comment_id:comment,state:'attached'});
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,comment)).toHaveLength(1);
    expect(await table('document_associations').where({document_id:document,entity_id:ticket}).first()).toBeTruthy();
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(true);
    expect(await canReadCommentAttachment(trx,tenant,otherUser,document)).toBe(false);
    expect(await listPublishedCommentAttachments(trx,randomUUID(),ticket,comment)).toEqual([]);
  });
  it('uses the model for new comments and replies and preserves the same reconciliation on edits', async () => {
    const first = await upload();
    const id = await Comment.insert(trx,tenant,{ticket_id:ticket,user_id:actor,author_type:'internal',note:note(first.file),is_internal:false,is_resolution:false} as any);
    const second = await upload('video.mp4','video/mp4');
    const reply = await Comment.insert(trx,tenant,{ticket_id:ticket,user_id:actor,author_type:'internal',note:note(second.file),parent_comment_id:id,is_internal:false,is_resolution:false} as any);
    expect((await listPublishedCommentAttachments(trx,tenant,ticket,id)).map(x=>x.file_id)).toEqual([first.file]);
    expect((await listPublishedCommentAttachments(trx,tenant,ticket,reply)).map(x=>x.file_id)).toEqual([second.file]);
    await Comment.update(trx,tenant,reply,{note:'[]'},actor);
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,reply)).toEqual([]);
    expect(await table('documents').where({document_id:second.document}).first()).toBeTruthy();
  });
  it('REST create, reply and edit use the same persisted attachment lifecycle', async () => {
    const { TicketService } = await import('@/lib/api/services/TicketService');
    const service = new TicketService();
    vi.spyOn(service as any,'getKnex').mockResolvedValue({knex:trx,tenant});
    const publish = vi.spyOn(service as any,'safePublishEvent').mockResolvedValue(undefined);
    const context = {tenant,userId:actor} as any;
    const pdf = await upload();
    const created = await service.addComment(ticket,{comment_text:note(pdf.file)} as any,context);
    const video = await upload('video.mp4','video/mp4');
    const reply = await service.addComment(ticket,{comment_text:note(video.file),parent_comment_id:created.comment_id} as any,context);
    expect((await listPublishedCommentAttachments(trx,tenant,ticket,reply.comment_id)).map(d=>d.document_id)).toEqual([video.document]);
    await service.updateComment(ticket,reply.comment_id,{comment_text:'[]'},context);
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,reply.comment_id)).toEqual([]);
    expect((await listPublishedCommentAttachments(trx,tenant,ticket,created.comment_id)).map(d=>d.document_id)).toEqual([pdf.document]);
    expect(publish).not.toHaveBeenCalled();
    const intents = await table('comments').whereIn('comment_id',[created.comment_id,reply.comment_id]);
    expect(intents.every(row => row.scheduled_publish_event_id && row.comment_publication_payload)).toBe(true);
    expect(intents.every(row => !row.scheduled_publish_dispatched_at)).toBe(true);
  });
  it('rejects other actors, expired uploads, another ticket and a second comment claim', async () => {
    const {document,file} = await upload();
    await table('comments').where({comment_id:comment}).update({note:note(file)});
    await expect(reconcileCommentAttachments(trx,tenant,comment,clientUser)).rejects.toThrow('another user');
    await table('ticket_comment_attachments').where({document_id:document}).update({expires_at:new Date(0)});
    await expect(reconcileCommentAttachments(trx,tenant,comment,actor)).rejects.toThrow('expired');
    await table('ticket_comment_attachments').where({document_id:document}).update({expires_at:new Date(Date.now()+10000),ticket_id:randomUUID()});
    await expect(reconcileCommentAttachments(trx,tenant,comment,actor)).rejects.toThrow('another ticket');
    await table('ticket_comment_attachments').where({document_id:document}).update({ticket_id:ticket});
    await reconcileCommentAttachments(trx,tenant,comment,actor);
    await reconcileCommentAttachments(trx,tenant,comment,actor); // idempotent same-comment retry
    const duplicate = await makeComment({note:note(file)});
    await expect(reconcileCommentAttachments(trx,tenant,duplicate,actor)).rejects.toThrow('another ticket or comment');
    expect(await table('ticket_comment_attachments').where({document_id:document})).toHaveLength(1);
  });
  it.each(['internal','scheduled','canceled','deleted','thread-internal'])('denies client listing/download/preview policy and email selection for %s', async state => {
    const {document,file} = await upload(); await attach(file);
    if (state === 'internal') await table('comments').where({comment_id:comment}).update({is_internal:true});
    if (state === 'scheduled' || state === 'canceled') await table('comments').where({comment_id:comment}).update({publish_state:state});
    if (state === 'deleted') await table('comments').where({comment_id:comment}).update({deleted_at:new Date()});
    if (state === 'thread-internal') await table('comment_threads').where({root_comment_id:comment}).update({is_internal:true});
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(false);
    const user = { ...await table('users').where({user_id:clientUser}).first(), clientId:client };
    expect(await getAuthorizedDocumentById(trx,tenant,user,document)).toBeNull();
    expect(await getAuthorizedDocumentByFileId(trx,tenant,user,file)).toBeNull();
    expect(await filterReadableCommentAttachments(trx,tenant,clientUser,[{document_id:document}])).toEqual([]);
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,comment)).toEqual([]);
  });
  it('scheduled publication reveals attachments; subsequent visibility change revokes them', async () => {
    const {document,file}=await upload(); await attach(file);
    await table('comments').where({comment_id:comment}).update({publish_state:'scheduled'});
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(false);
    await table('comments').where({comment_id:comment}).update({publish_state:'published'});
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(true);
    await table('comments').where({comment_id:comment}).update({is_internal:true});
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(false);
  });
  it('abandoned and removed drafts send no attachments and preserve shared documents', async () => {
    const {document,file}=await upload();
    await table('document_associations').insert({tenant,document_id:document,entity_type:'client',entity_id:client});
    await table('ticket_comment_attachments').where({document_id:document}).update({expires_at:new Date(0)});
    expect(await expireCommentAttachmentDrafts(trx,tenant)).toBe(1);
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,comment)).toEqual([]);
    expect(await table('documents').where({document_id:document}).first()).toBeTruthy();
    expect(await table('document_associations').where({document_id:document})).toHaveLength(2);
    expect(await canReadCommentAttachment(trx,tenant,clientUser,document)).toBe(false);
  });
  it('emits actual PDF MIME bytes, excludes unrelated files and deduplicates repeated inline images by document', async () => {
    const pdf=await upload(), img=await upload('picture.png','image/png'); await upload('unrelated.pdf');
    await table('comments').where({comment_id:comment}).update({note:JSON.stringify([
      {type:'file',props:{url:`/api/documents/download/${pdf.file}`,name:'report.pdf'}},
      ...[1,2].map(()=>({type:'image',props:{url:`/api/documents/view/${img.file}`,name:'picture.png'}})),
    ])});
    await reconcileCommentAttachments(trx,tenant,comment,actor);
    const prepared=await prepareCommentAttachmentEmail({db:trx,tenant,ticketId:ticket,commentId:comment,recipient,maxAttachmentBytes:3000000,supportsAttachments:true,baseUrl:'http://localhost',download:async id=>{expect(getTenantContext()).toBe(tenant);return {buffer:Buffer.from(id===pdf.file?'%PDF-test':'PNG-test')};}});
    expect(prepared.attachments).toHaveLength(2);
    expect(prepared.attachments.filter(x=>x.cid)).toHaveLength(1);
    const transport=nodemailer.createTransport({streamTransport:true,buffer:true});
    const sent=await transport.sendMail({from:'agent@example.test',to:recipient,subject:'Attachment test',html:prepared.html,text:prepared.text,attachments:prepared.attachments});
    const parsed=await simpleParser(sent.message);
    expect(parsed.attachments).toHaveLength(2);
    expect(parsed.attachments.find(x=>x.filename==='report.pdf')?.content.toString()).toBe('%PDF-test');
  });
  it('produces recipient-bound expiring fallback links for large/provider-restricted files', async () => {
    const {document,file}=await upload('large.pdf','application/pdf',9000000); await attach(file);
    const download=vi.fn();
    const prepared=await prepareCommentAttachmentEmail({db:trx,tenant,ticketId:ticket,commentId:comment,recipient,maxAttachmentBytes:3000000,supportsAttachments:false,baseUrl:'http://localhost',signingSecret:'test-secret',download});
    expect(download).not.toHaveBeenCalled(); expect(prepared.attachments).toEqual([]);
    expect(prepared.html).toContain('email provider limits');
    const token=decodeURIComponent(prepared.html.match(/token=([^"<]+)/)![1]);
    const claims=verifyAttachmentLink(token,'test-secret',recipient)!;
    expect(claims).toMatchObject({documentId:document,commentId:comment,tenant});
    expect(verifyAttachmentLink(token,'test-secret','other@example.test')).toBeNull();
    expect(verifyAttachmentLink(token,'test-secret',recipient,claims.expiresAt)).toBeNull();
    expect(verifyAttachmentLink(token+'x','test-secret',recipient)).toBeNull();
    await table('comments').where({comment_id:comment}).update({is_internal:true});
    expect(await canReadCommentAttachment(trx,tenant,clientUser,claims.documentId)).toBe(false);
  });
  it('does not record a send when attachment storage fails; durable per-recipient delivery survives partial failures', async () => {
    const {file}=await upload(); await attach(file);
    await expect(prepareCommentAttachmentEmail({db:trx,tenant,ticketId:ticket,commentId:comment,recipient,maxAttachmentBytes:3000000,supportsAttachments:true,baseUrl:'http://localhost',download:async()=>{throw new Error('storage unavailable');}})).rejects.toThrow('storage unavailable');
    expect(await table('ticket_comment_email_deliveries')).toEqual([]);
    expect(await claimCommentEmailDelivery(trx,tenant,comment,recipient)).toBe(true);
    await finishCommentEmailDelivery(trx,tenant,comment,recipient,'sent');
    expect(await claimCommentEmailDelivery(trx,tenant,comment,recipient)).toBe(false);
    expect(await claimCommentEmailDelivery(trx,tenant,comment,'second@example.test')).toBe(true);
    await finishCommentEmailDelivery(trx,tenant,comment,'second@example.test','failed');
    expect(await claimCommentEmailDelivery(trx,tenant,comment,'second@example.test')).toBe(true);
    expect(await claimCommentEmailDelivery(trx,tenant,comment,'second@example.test')).toBe(false); // unknown outcome remains claimed
    await Comment.update(trx,tenant,comment,{note:note(file)+' '},actor);
    expect(await claimCommentEmailDelivery(trx,tenant,comment,recipient)).toBe(false); // unrelated edit cannot resend
  });
  it('serves fallback bytes only for the authenticated recipient and revokes expired or internal links', async () => {
    const uploaded = await upload(); await attach(uploaded.file);
    routeSession.user = { ...await table('users').where({user_id:clientUser}).first(), clientId:client };
    routeSession.permitted = true;
    const connection = vi.spyOn(dbModule,'createTenantKnex').mockResolvedValue({knex:trx,tenant} as any);
    const storage = vi.spyOn(StorageService,'downloadFile').mockResolvedValue({buffer:Buffer.from('%PDF-route')} as any);
    try {
      const { GET } = await import('@/app/api/ticket-comment-attachments/download/route');
      const secret = await attachmentSigningSecret();
      const claims = {tenant,ticketId:ticket,commentId:comment,documentId:uploaded.document,recipient,expiresAt:Date.now()+60000};
      const request = (overrides = {}) => new NextRequest('http://localhost/api/ticket-comment-attachments/download?token='+encodeURIComponent(signAttachmentLink({...claims,...overrides},secret)));
      const response = await GET(request());
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('%PDF-route');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect((await GET(request({expiresAt:0}))).status).toBe(403);
      routeSession.user = {...routeSession.user,email:'wrong@example.test'};
      expect((await GET(request())).status).toBe(403);
      routeSession.user.email = recipient;
      routeSession.permitted = false;
      expect((await GET(request())).status).toBe(403);
      routeSession.permitted = true;
      await table('comments').where({comment_id:comment}).update({is_internal:true});
      expect((await GET(request())).status).toBe(403);
      routeSession.user = null;
      expect(await (await GET(request())).text()).toContain('A portal account is not required');
      expect(storage).toHaveBeenCalledTimes(1);
    } finally { connection.mockRestore(); storage.mockRestore(); }
  });
  it('heals an intent missing its author identity and dispatches the real sender once', async () => {
    const { EventSchemas } = await import('@alga-psa/event-schemas');
    const stuck = await makeComment({
      user_id: null, author_type: 'unknown',
      metadata: JSON.stringify({ email: { fromAddress: 'unmatched@example.test', fromName: 'Unmatched Sender' } }),
    });
    // The shape production persisted before the producer fix: no userId and no
    // comment.author, so every reconcile pass failed strict validation.
    const eventId = randomUUID();
    await table('comments').where({comment_id:stuck}).update({
      scheduled_publish_event_id: eventId,
      comment_publication_payload: JSON.stringify({tenantId:tenant,ticketId:ticket,commentId:stuck,comment:{id:stuck,content:'[]'}}),
    });
    const publish = vi.fn(async (_event: any, _options?: any) => undefined);
    await dispatchCommentPublication(trx, tenant, stuck, publish);
    await dispatchCommentPublication(trx, tenant, stuck, publish);
    expect(publish).toHaveBeenCalledTimes(1);
    const [event, options] = publish.mock.calls[0] as [any, any];
    expect(options.eventId).toBe(eventId);
    expect(event.payload).toMatchObject({actorType:'SYSTEM',comment:{author:'Unmatched Sender'}});
    expect(event.payload).not.toHaveProperty('userId');
    expect(() => EventSchemas.TICKET_COMMENT_ADDED.parse({
      id: randomUUID(), timestamp: new Date().toISOString(), ...event,
    })).not.toThrow();
    expect((await table('comments').where({comment_id:stuck}).first()).scheduled_publish_dispatched_at).toBeTruthy();
  });
  it('publishes a user-less scheduled comment as a SYSTEM actor (no userId) with the real sender', async () => {
    const publishers = await import('@alga-psa/event-bus/publishers');
    const { EventSchemas } = await import('@alga-psa/event-schemas');
    const scheduled = await makeComment({
      user_id: null, author_type: 'unknown',
      publish_state: 'scheduled', scheduled_publish_at: new Date(Date.now() - 60000),
      metadata: JSON.stringify({ email: { fromAddress: 'unmatched@example.test' } }),
    });
    await table('tickets').where({ticket_id:ticket}).update({response_state:'awaiting_client'});
    const connection = vi.spyOn(dbModule,'getConnection').mockResolvedValue(trx);
    const publish = vi.spyOn(publishers,'publishBuiltWorkflowPayload').mockResolvedValue(undefined);
    try {
      const {publishScheduledCommentHandler} = await import('@/lib/jobs/handlers/publishScheduledCommentHandler');
      await publishScheduledCommentHandler({tenantId:tenant,ticketId:ticket,commentId:scheduled});
      const [event] = publish.mock.calls[0] as [any, any];
      expect(event.payload).toMatchObject({actorType:'SYSTEM',comment:{author:'unmatched@example.test'}});
      expect(event.payload).not.toHaveProperty('userId');
      expect(() => EventSchemas.TICKET_COMMENT_ADDED.parse({
        id: randomUUID(), timestamp: new Date().toISOString(), ...event,
      })).not.toThrow();
    } finally { connection.mockRestore(); publish.mockRestore(); }
  });
  it('serializes competing claims and publishes shared-model events only after commit', async () => {
    const uploaded = await upload();
    const first = await makeComment({note:note(uploaded.file)});
    const second = await makeComment({note:note(uploaded.file)});
    const publisher = { publishCommentCreated: vi.fn(async () => undefined) };
    await TicketModel.createComment({ticket_id:ticket,content:'Committed publication',author_id:actor,author_type:'internal'},tenant,trx,publisher as any,undefined,actor);
    expect(publisher.publishCommentCreated).not.toHaveBeenCalled();
    await trx.commit();
    const intent = await tenantDb(conn,tenant).table('comments').whereNotNull('comment_publication_payload').first();
    const dispatch = vi.fn().mockRejectedValueOnce(new Error('stream unavailable')).mockResolvedValue(undefined);
    await expect(dispatchCommentPublication(conn,tenant,intent.comment_id,dispatch)).rejects.toThrow('stream unavailable');
    expect((await tenantDb(conn,tenant).table('comments').where({comment_id:intent.comment_id}).first()).scheduled_publish_dispatched_at).toBeNull();
    await dispatchCommentPublication(conn,tenant,intent.comment_id,dispatch);
    await dispatchCommentPublication(conn,tenant,intent.comment_id,dispatch);
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(dispatch.mock.calls[0][1].eventId).toBe(dispatch.mock.calls[1][1].eventId);
    try {
      const results = await Promise.allSettled([first,second].map(id => conn.transaction(async competing => {
        await reconcileCommentAttachments(competing,tenant,id,actor);
      })));
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
      const winner = await tenantDb(conn,tenant).table('ticket_comment_attachments').where({document_id:uploaded.document}).first();
      expect([first,second]).toContain(winner.comment_id);
    } finally {
      for (const name of ['ticket_comment_attachments','comments','comment_threads','document_associations','documents','external_files','tickets','users','contacts','clients']) {
        await tenantDb(conn,tenant).table(name).delete();
      }
      await tenantDb(conn,tenant).unscoped('tenants','remove isolated fixture tenant').where({tenant}).delete();
    }
  });

  it.each(['internal','draft','removed','scheduled','board-restricted'])('portal global actions exclude %s before pagination, counts and folder discovery', async state => {
    const hidden = await upload('hidden.pdf');
    await table('documents').where({document_id:hidden.document}).update({folder_path:'/secret-folder'});
    if (state !== 'draft') await attach(hidden.file);
    if (state === 'internal') await table('comments').where({comment_id:comment}).update({is_internal:true});
    if (state === 'removed') await table('ticket_comment_attachments').where({document_id:hidden.document}).update({state:'removed'});
    if (state === 'scheduled') await table('comments').where({comment_id:comment}).update({publish_state:'scheduled'});
    if (state === 'board-restricted') {
      const group = randomUUID();
      await table('client_portal_visibility_groups').insert({tenant,group_id:group,client_id:client,name:'Restricted'});
      const u = await table('users').where({user_id:clientUser}).first();
      await table('contacts').where({contact_name_id:u.contact_id}).update({portal_visibility_group_id:group});
    }
    // A direct/shared association must never bypass the attachment policy.
    await table('document_associations').insert({tenant,document_id:hidden.document,entity_type:'client',entity_id:client});
    const normal = await upload('ordinary.pdf');
    await table('ticket_comment_attachments').where({document_id:normal.document}).delete();
    await table('documents').where({document_id:normal.document}).update({folder_path:'/ordinary'});
    routeSession.user = {...await table('users').where({user_id:clientUser}).first(),tenant};
    routeSession.permitted = true;
    const connection = vi.spyOn(dbModule,'getConnection').mockResolvedValue(trx);
    try {
      const {getClientDocuments,getClientDocumentFolders,downloadClientDocument} = await import('@alga-psa/client-portal/actions/client-portal-actions/client-documents');
      const page = await getClientDocuments(1,1) as any;
      expect(page.total).toBe(1); expect(page.totalPages).toBe(1);
      expect(page.documents.map((d:any)=>d.document_id)).toEqual([normal.document]);
      expect(page.documents[0].file_size).toBe(12);
      expect(JSON.stringify(await getClientDocumentFolders())).not.toContain('secret-folder');
      expect((await downloadClientDocument(normal.document) as any).document_id).toBe(normal.document);
      await expect(downloadClientDocument(hidden.document)).rejects.toThrow('access denied');
    } finally { connection.mockRestore(); }
  });
  it('rechecks document visibility before email bytes and guest fallback redemption', async () => {
    const pdf = await upload(); await attach(pdf.file);
    await table('documents').where({document_id:pdf.document}).update({is_client_visible:false});
    const download=vi.fn();
    const prepared=await prepareCommentAttachmentEmail({db:trx,tenant,ticketId:ticket,commentId:comment,recipient,maxAttachmentBytes:3000000,supportsAttachments:true,baseUrl:'http://localhost',download});
    expect(download).not.toHaveBeenCalled(); expect(prepared.attachments).toEqual([]); expect(prepared.downloadLinks).toEqual([]);
  });
  it('guest mailbox verification binds browser, expires, limits attempts and rechecks current access', async () => {
    const {issueAttachmentChallenge,redeemAttachmentChallenge} = await import('@/lib/notifications/ticketCommentAttachmentVerification');
    const {authorizedRecipientCommentDocument} = await import('@/lib/notifications/ticketCommentAttachmentEmail');
    const pdf = await upload(); await attach(pdf.file);
    await table('users').where({user_id:clientUser}).delete();
    const claims={tenant,ticketId:ticket,commentId:comment,documentId:pdf.document,recipient,expiresAt:Date.now()+3600000};
    const token=signAttachmentLink(claims,'secret'); let code='';
    const browser=await issueAttachmentChallenge(trx,claims,token,'secret',async c=>{code=c;});
    expect(await authorizedRecipientCommentDocument(trx,tenant,ticket,comment,pdf.document,recipient)).toBeTruthy();
    expect(await redeemAttachmentChallenge(trx,claims,token,'secret','other-browser',code)).toBe(false);
    expect(await redeemAttachmentChallenge(trx,claims,token,'secret',browser,code,claims.expiresAt)).toBe(false);
    expect(await redeemAttachmentChallenge(trx,claims,token,'secret',browser,code)).toBe(true);
    expect(await redeemAttachmentChallenge(trx,claims,token,'secret',browser,code)).toBe(false);
    await table('comments').where({comment_id:comment}).update({is_internal:true});
    expect(await authorizedRecipientCommentDocument(trx,tenant,ticket,comment,pdf.document,recipient)).toBeNull();
    const token2=signAttachmentLink({...claims,expiresAt:claims.expiresAt+1},'secret');
    const browser2=await issueAttachmentChallenge(trx,claims,token2,'secret',async c=>{code=c;});
    for(let i=0;i<5;i++) expect(await redeemAttachmentChallenge(trx,claims,token2,'secret',browser2,'000000')).toBe(false);
    expect(await redeemAttachmentChallenge(trx,claims,token2,'secret',browser2,code)).toBe(false);
  });
  it('cleans expired exclusively owned drafts with retryable storage deletion and preserves shared content', async () => {
    const {cleanupCommentAttachmentDrafts} = await import('@/lib/jobs/handlers/cleanupCommentAttachmentDrafts');
    const owned=await upload(), shared=await upload('shared.pdf');
    await table('document_associations').insert({tenant,document_id:shared.document,entity_type:'client',entity_id:client});
    await table('ticket_comment_attachments').update({expires_at:new Date(0)});
    const remove=vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue(undefined);
    await cleanupCommentAttachmentDrafts(trx,tenant,remove);
    expect(await table('documents').where({document_id:owned.document}).first()).toBeUndefined();
    expect(await table('documents').where({document_id:shared.document}).first()).toBeTruthy();
    expect((await table('ticket_comment_attachments').where({document_id:shared.document}).first()).cleanup_completed_at).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(1);
    await cleanupCommentAttachmentDrafts(trx,tenant,remove);
    expect(remove).toHaveBeenCalledTimes(2);
    expect((await table('ticket_comment_attachments').where({document_id:owned.document}).first()).cleanup_completed_at).toBeTruthy();
  });
  it('preserves a file acquired by another document between failed cleanup and retry', async () => {
    const { cleanupCommentAttachmentDrafts } = await import('@/lib/jobs/handlers/cleanupCommentAttachmentDrafts');
    const owned = await upload();
    await table('ticket_comment_attachments').update({ expires_at: new Date(0) });
    const remove = vi.fn().mockRejectedValueOnce(new Error('storage unavailable'));
    await cleanupCommentAttachmentDrafts(trx, tenant, remove);
    const sharedId = randomUUID();
    await table('documents').insert({ tenant, document_id: sharedId, file_id: owned.file,
      document_name: 'Shared after staging', user_id: actor, created_by: actor });
    await cleanupCommentAttachmentDrafts(trx, tenant, remove);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(await table('documents').where({ document_id: sharedId }).first()).toBeTruthy();
    expect((await table('external_files').where({ file_id: owned.file }).first()).deleted_at).toBeNull();
  });
  it('portal action claims new and reply files, keeps the public thread, and rejects hidden parents', async () => {
    routeSession.user = { ...await table('users').where({ user_id: clientUser }).first(), tenant };
    routeSession.permitted = true;
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const publisher = await import('@alga-psa/event-bus/publishers');
    const live = await import('@alga-psa/tickets/lib/liveUpdates');
    const publish = vi.spyOn(publisher, 'publishEvent').mockResolvedValue(undefined);
    const update = vi.spyOn(live, 'publishTicketUpdate').mockResolvedValue(undefined);
    try {
      const { addClientTicketComment } = await import('@alga-psa/client-portal/actions/client-portal-actions/client-tickets');
      const pdf = await upload('portal.pdf', 'application/pdf', 12, clientUser);
      expect(await addClientTicketComment(ticket, note(pdf.file), false, false)).toBe(true);
      const root = await table('comments').where({ user_id: clientUser }).first();
      const reply = await upload('portal-reply.webm', 'video/webm', 12, clientUser);
      expect(await addClientTicketComment(ticket, note(reply.file), false, false, root.comment_id)).toBe(true);
      const child = await table('comments').where({ parent_comment_id: root.comment_id }).first();
      expect(child.thread_id).toBe(root.thread_id);
      expect((await table('ticket_comment_attachments').where({ document_id: reply.document }).first()).comment_id).toBe(child.comment_id);
      expect(child.comment_publication_payload).toBeTruthy();
      expect((await table('comment_threads').where({ thread_id: root.thread_id }).first()).reply_count).toBe(1);
      await table('comments').where({ comment_id: root.comment_id }).update({ is_internal: true });
      expect(await addClientTicketComment(ticket, note(reply.file), false, false, root.comment_id)).not.toBe(true);
    } finally { connection.mockRestore(); publish.mockRestore(); update.mockRestore(); }
  });
  it.each(['same-client', 'other-client', 'no-mirror', 'client-email', 'no-attachment', 'provider-limited', 'failed-retry',
    'source-internal', 'source-canceled', 'source-deleted', 'child-internal', 'child-canceled', 'detached', 'wrong-tenant',
    'wrong-source-ticket', 'wrong-reply-comment', 'forged-mirror', 'disabled-child', 'blocked-child-board', 'retry-revoked', 'removed-file'])('bundled %s notifications preserve source authorization and child reply identity on replay', async mode => {
    const { TenantEmailService } = await import('@alga-psa/email');
    const { SMTPEmailProvider } = await import('@alga-psa/email/providers/SMTPEmailProvider');
    const { ticketEmailSubscriberTestHarness } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber');
    const pdf = await upload(); await upload('unrelated-draft.pdf');
    const unrelated = await upload('other-comment.pdf');
    await attach(unrelated.file, await makeComment());
    const internal = await upload('internal.pdf');
    await attach(internal.file, await makeComment({ is_internal: true }));
    const canceled = await upload('canceled.pdf');
    await table('ticket_comment_attachments').where({ document_id: canceled.document }).update({ state: 'removed' });
    if (mode !== 'no-attachment') await attach(pdf.file);
    const content = JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Public bundle update' }] },
      ...(mode === 'no-attachment' ? [] : JSON.parse(note(pdf.file)))]);
    await table('comments').where({ comment_id: comment }).update({ note: content });
    const primary = await table('contacts').where({ email: recipient }).first();
    await table('tickets').where({ ticket_id: ticket }).update({ contact_name_id: primary.contact_name_id });
    const child = randomUUID(), mirror = randomUUID(), thread = randomUUID();
    const childEmail = mode === 'other-client' ? 'other@example.test' : 'bundle-child@example.test';
    let childContact = await table('contacts').where({ email: childEmail }).first();
    if (!childContact) [childContact] = await table('contacts').insert({ tenant, contact_name_id: randomUUID(), client_id: client, full_name: 'Child requester', email: childEmail }).returning('*');
    await table('tickets').insert({ tenant, ticket_id: child, ticket_number: 'ATT-CHILD', client_id: childContact.client_id,
      contact_name_id: childContact.contact_name_id, title: 'Child ticket', entered_by: actor, master_ticket_id: ticket });
    if (mode === 'client-email') {
      await table('tickets').where({ ticket_id: child }).update({ contact_name_id: null });
      await table('contacts').where({ contact_name_id: childContact.contact_name_id }).delete();
      await table('client_locations').insert({ tenant, location_id: randomUUID(), client_id: client, location_name: 'Default',
        address_line1: '1 Test Street', city: 'Test', country_code: 'US', country_name: 'United States', is_default: true, is_active: true, email: childEmail });
    }
    if (mode !== 'no-mirror') {
      await table('comment_threads').insert({ tenant, thread_id: thread, ticket_id: child, root_comment_id: mirror, is_internal: false, created_by: actor });
      await table('comments').insert({ tenant, comment_id: mirror, thread_id: thread, ticket_id: child, note: content, is_internal: false, is_resolution: false, is_system_generated: true });
      await table('ticket_bundle_mirrors').insert({ tenant, source_comment_id: comment, child_ticket_id: child, child_comment_id: mirror });
    }
    await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Bundle update', html_content: '{{{comment.content}}}', text_content: '{{comment.text}}' });
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3653');
    const bytes = Buffer.from('%PDF-bundled-notification'), messages: any[] = [];
    const { sendEventEmail } = await import('@/lib/notifications/sendEventEmail');
    const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
    const secretProvider = await getSecretProviderInstance();
    const getAppSecret = secretProvider.getAppSecret.bind(secretProvider);
    // Keep infrastructure secrets real: replacing every lookup makes the event
    // bus send the attachment signing key as the Redis password.
    const secret = vi.spyOn(secretProvider, 'getAppSecret').mockImplementation(async name =>
      name === 'NEXTAUTH_SECRET' || name === 'nextauth_secret'
        ? 'bundle-test-secret'
        : getAppSecret(name)
    );
    const provider = new SMTPEmailProvider('bundle-test');
    if (mode === 'provider-limited') provider.capabilities.maxAttachmentSize = 1;
    const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
    // Optional local smoke sends only synthetic fixtures to the loopback GreenMail sink.
    const smtp = process.env.COMMENT_BUNDLE_LIVE_SMOKE === '1'
      ? nodemailer.createTransport({ host: '127.0.0.1', port: 3025, secure: false, ignoreTLS: true }) : null;
    (provider as any).initialized = true; (provider as any).config = { from: 'agent@example.test' };
    (provider as any).transporter = { sendMail: async (mail: any) => {
      const sent = await stream.sendMail(mail);
      if (smtp) await smtp.sendMail({ envelope: sent.envelope, raw: sent.message as Buffer });
      messages.push(await simpleParser(sent.message as Buffer)); return sent;
    } };
    const service = TenantEmailService.getInstance(tenant);
    const snapshot = vi.spyOn(service as any, 'refreshProviderState').mockResolvedValue({ emailProvider: provider, providerInitError: null, fromAddress: 'agent@example.test' });
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const tenantConnection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    const storage = vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: bytes } as any);
    const event = { id: randomUUID(), eventType: 'TICKET_COMMENT_ADDED', payload: { tenantId: tenant, ticketId: ticket, actorUserId: actor,
      comment: { id: comment, content, author: 'Agent', isInternal: false } } } as any;
    try {
      const pending = { mailClass: 'ticket' as const, tenantId: tenant, to: childEmail, subject: 'Pending bundle update', template: 'ticket-comment-added', locale: 'en' as const,
        context: { ticket: { id: 'ATT-CHILD' }, comment: { content } },
        commentSource: { ticketId: ticket, commentId: comment }, replyContext: { ticketId: child } };
      if (['source-internal', 'source-canceled', 'source-deleted', 'child-internal', 'child-canceled', 'detached', 'wrong-tenant', 'wrong-source-ticket', 'wrong-reply-comment', 'forged-mirror', 'disabled-child', 'blocked-child-board', 'retry-revoked'].includes(mode)) {
        if (mode === 'wrong-source-ticket') pending.commentSource.ticketId = child;
        if (mode === 'wrong-reply-comment') Object.assign(pending.replyContext, { commentId: comment });
        if (mode === 'forged-mirror') await table('ticket_bundle_mirrors').where({ source_comment_id: comment, child_ticket_id: child }).update({ child_comment_id: comment });
        if (mode === 'disabled-child') await table('users').insert({ tenant, user_id: randomUUID(), username: randomUUID(),
          email: childEmail, hashed_password: 'unused', user_type: 'client', contact_id: childContact.contact_name_id, is_inactive: true });
        if (mode === 'blocked-child-board') {
          const group = randomUUID();
          await table('client_portal_visibility_groups').insert({ tenant, group_id: group, client_id: client, name: 'No boards' });
          await table('contacts').where({ contact_name_id: childContact.contact_name_id }).update({ portal_visibility_group_id: group });
        }
        if (mode === 'retry-revoked') {
          const reject = vi.spyOn(service, 'sendEmail').mockResolvedValueOnce({ success: false, error: 'Rate limited', providerId: 'bundle-test', providerType: 'smtp',
            metadata: { retryable: true, definitelyNotSent: true, status: 429 } });
          try { await expect(sendEventEmail(pending)).rejects.toMatchObject({ isRetryable: true }); }
          finally { reject.mockRestore(); }
          await table('comments').where({ comment_id: mirror }).update({ is_internal: true });
          storage.mockClear();
        }
        if (mode === 'source-internal') await table('comments').where({ comment_id: comment }).update({ is_internal: true });
        if (mode === 'source-canceled') await table('comments').where({ comment_id: comment }).update({ publish_state: 'canceled' });
        if (mode === 'source-deleted') await table('comments').where({ comment_id: comment }).update({ deleted_at: new Date() });
        if (mode === 'child-internal') await table('comment_threads').where({ thread_id: thread }).update({ is_internal: true });
        if (mode === 'child-canceled') await table('comments').where({ comment_id: mirror }).update({ publish_state: 'canceled' });
        if (mode === 'detached') await table('tickets').where({ ticket_id: child }).update({ master_ticket_id: null });
        if (mode === 'wrong-tenant') {
          const foreignTenant = randomUUID();
          await tenantDb(trx, foreignTenant).unscoped('tenants', 'create isolated foreign tenant').insert({ tenant: foreignTenant, client_name: 'Other tenant', email: 'foreign@example.test', product_code: 'psa' });
          await tenantDb(trx, foreignTenant).table('tenant_email_templates').insert({ tenant: foreignTenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Update', html_content: '{{{comment.content}}}', text_content: '{{comment.text}}' });
          pending.tenantId = foreignTenant;
        }
        await sendEventEmail(pending);
        expect(messages).toHaveLength(0);
        expect(await table('ticket_comment_email_deliveries')).toHaveLength(mode === 'retry-revoked' ? 1 : 0);
        if (mode === 'retry-revoked') expect(await table('ticket_comment_email_deliveries').first()).toMatchObject({ state: 'failed', attempts: 1 });
        expect(storage).not.toHaveBeenCalled();
        return;
      }
      if (mode === 'failed-retry') {
        const reject = vi.spyOn(service, 'sendEmail').mockResolvedValueOnce({ success: false, error: 'Rate limited', providerId: 'bundle-test', providerType: 'smtp',
          metadata: { retryable: true, definitelyNotSent: true, status: 429 } });
        try { await expect(sendEventEmail(pending)).rejects.toMatchObject({ isRetryable: true }); }
        finally { reject.mockRestore(); }
        expect((await table('ticket_comment_email_deliveries').where({ comment_id: comment, recipient: childEmail }).first()).state).toBe('failed');
      }
      if (mode === 'removed-file') await table('ticket_comment_attachments').where({ document_id: pdf.document }).update({ state: 'removed' });
      await ticketEmailSubscriberTestHarness.handleTicketCommentAdded(event);
      expect(messages).toHaveLength(2);
      const masterMail = messages.find(mail => mail.to.value[0].address === recipient);
      const childMail = messages.find(mail => mail.to.value[0].address === childEmail);
      expect(masterMail.attachments.map((a: any) => a.content)).toEqual(['provider-limited', 'no-attachment', 'removed-file'].includes(mode) ? [] : [bytes]);
      expect(childMail.text).toContain('Public bundle update');
      expect(childMail.text).toContain(`ALGA-TICKET-ID:${child}`);
      expect(childMail.text).not.toContain(`ALGA-COMMENT-ID:${comment}`);
      if (mode !== 'no-mirror') expect(childMail.text).toContain(`ALGA-COMMENT-ID:${mirror}`);
      else expect(childMail.text).not.toContain('ALGA-COMMENT-ID:');
      expect(childMail.attachments.map((a: any) => a.content)).toEqual(['other-client', 'provider-limited', 'no-attachment', 'removed-file'].includes(mode) ? [] : [bytes]);
      if (mode === 'provider-limited') {
        expect(childMail.text).toContain('email provider limits');
        const token = childMail.text.match(/download\?token=([^\s]+)/)[1];
        expect(verifyAttachmentLink(decodeURIComponent(token), 'bundle-test-secret')).toMatchObject({ tenant, ticketId: ticket, commentId: comment, documentId: pdf.document, recipient: childEmail });
      }
      if (mode === 'other-client') {
        expect(childMail.html).not.toContain(pdf.file);
        expect(childMail.html).not.toContain('/api/ticket-comment-attachments/download');
        expect(await canReadCommentAttachment(trx, tenant, otherUser, pdf.document)).toBe(false);
      }
      const token = await table('email_reply_tokens').where({ ticket_id: child, recipient_email: childEmail }).first();
      expect(token.comment_id).toBe(mode === 'no-mirror' ? null : mirror);
      if (mode === 'no-attachment') {
        expect(await table('ticket_comment_email_deliveries')).toHaveLength(0);
        expect(storage).not.toHaveBeenCalled();
        return; // Unmanaged comments retain their existing notification lifecycle.
      }
      expect(await table('ticket_comment_attachments').where({ document_id: pdf.document })).toMatchObject([{ ticket_id: ticket, comment_id: comment }]);
      await ticketEmailSubscriberTestHarness.handleTicketCommentAdded(event);
      expect(messages).toHaveLength(2);
      expect((await table('ticket_comment_email_deliveries').where({ comment_id: comment, recipient: childEmail }).first())).toMatchObject({ state: 'sent', attempts: mode === 'failed-retry' ? 2 : 1 });
      expect((await table('ticket_comment_email_deliveries').where({ comment_id: comment, recipient }).first())).toMatchObject({ state: 'sent', attempts: 1 });
      if (smtp) {
        for (const [mailbox, marker, expected] of [[recipient, `ALGA-COMMENT-ID:${comment}`, masterMail], [childEmail, `ALGA-TICKET-ID:${child}`, childMail]] as const) {
          const response = await fetch(`http://127.0.0.1:8080/api/user/${encodeURIComponent(mailbox)}/messages`);
          expect(response.ok).toBe(true);
          const received = await Promise.all((await response.json() as any[]).map(row => simpleParser(row.mimeMessage)));
          const matching = received.filter(mail => mail.text?.includes(marker));
          expect(matching).toHaveLength(1);
          expect(matching[0].attachments.map(a => a.content)).toEqual(expected.attachments.map((a: any) => a.content));
          expect(matching[0].text).toBe(expected.text);
        }
      }
    } finally { connection.mockRestore(); tenantConnection.mockRestore(); storage.mockRestore(); snapshot.mockRestore(); secret.mockRestore(); stream.close(); smtp?.close(); vi.unstubAllEnvs(); }
  });

  it.each(['resend', 'graph'])('%s recovers confirmed provider non-delivery through the queue without repeating a successful recipient, and exposes ambiguous outcomes', async providerKind => {
    const {TenantEmailService}=await import('@alga-psa/email');
    const {ResendEmailProvider}=await import('@alga-psa/email/providers/ResendEmailProvider');
    const {sendEventEmail}=await import('@/lib/notifications/sendEventEmail');
    const {EventEmailRetryQueue}=await import('@/lib/notifications/EventEmailRetryQueue');
    const pdf=await upload(); await attach(pdf.file);
    await table('contacts').insert({tenant,contact_name_id:randomUUID(),client_id:client,full_name:'Second',email:'second@example.test'});
    await table('tenant_email_templates').insert({tenant,name:'ticket-comment-added',language_code:'en',subject:'Recovery',html_content:'{{{comment.content}}}',text_content:'{{comment.text}}'});
    const {MicrosoftGraphEmailProvider}=await import('@alga-psa/email/providers/MicrosoftGraphEmailProvider');
    const {MicrosoftGraphAdapter}=await import('@shared/services/email/providers/MicrosoftGraphAdapter');
    const provider = providerKind === 'graph' ? new MicrosoftGraphEmailProvider('test-graph') : new ResendEmailProvider('test-resend');
    // Transport seam only: actual adapter/provider, service, ledger and queue execute.
    (provider as any).initialized=true; (provider as any).config={apiKey:'test'};
    let outcome: 'success'|'rejected'|'unknown'='success';
    const transport=vi.fn(async()=>{
      if(outcome==='rejected') throw {response:{status:429,data:{error:{code:'ErrorTooManyRequests',message:'Rate limited'},message:'Rate limited'},headers:{'retry-after':'17'}}};
      if(outcome==='unknown') throw {code:'ECONNRESET'};
      return {data:{id:randomUUID()},headers:{'request-id':'graph-request'}};
    });
    if (providerKind === 'graph') {
      const adapter = new MicrosoftGraphAdapter({mailbox:'agent@example.test',provider_type:'microsoft',provider_config:{}} as any);
      (adapter as any).httpClient={post:transport};
      (provider as any).adapter=adapter; (provider as any).mailbox='agent@example.test';
    } else {
      (provider as any).client={post:transport};
      vi.spyOn(provider as any,'delay').mockResolvedValue(undefined);
    }
    const service=TenantEmailService.getInstance(tenant);
    const snapshot=vi.spyOn(service as any,'refreshProviderState').mockResolvedValue({emailProvider:provider,providerInitError:null,fromAddress:'agent@example.test'});
    const connection=vi.spyOn(dbModule,'getConnection').mockResolvedValue(trx);
    const tenantConnection=vi.spyOn(dbModule,'createTenantKnex').mockResolvedValue({knex:trx,tenant} as any);
    const storage=vi.spyOn(StorageService,'downloadFile').mockResolvedValue({buffer:Buffer.from('%PDF-recovery')} as any);
    const data=new Map<string,string>(), scores=new Map<string,Map<string,number>>();
    const redis={get:async(k:string)=>data.get(k)||null,set:async(k:string,v:string)=>{data.set(k,v);},del:async(k:string)=>Number(data.delete(k)),
      eval:async(script:string,args:any)=>{if(script.startsWith('local ids'))return 0;return Number(scores.get(args.keys[0])?.delete(args.arguments[0]));},
      zAdd:async(k:string,x:any)=>{if(!scores.has(k))scores.set(k,new Map());scores.get(k)!.set(x.value,x.score);return 1;},
      zRem:async(k:string,id:string)=>Number(scores.get(k)?.delete(id)),zRangeByScore:async(k:string)=>[...(scores.get(k)?.keys()||[])],zCard:async(k:string)=>scores.get(k)?.size||0};
    (EventEmailRetryQueue as any).instance=null;
    const queue=EventEmailRetryQueue.getInstance({checkIntervalMs:3600000}); await queue.initialize(async()=>redis as any);
    const params={mailClass:'ticket' as const,tenantId:tenant,to:recipient,subject:'Recovery',template:'ticket-comment-added',context:{ticket:{id:'ATT-1'},comment:{content:'ignored'}},replyContext:{ticketId:ticket,commentId:comment}};
    routeSession.permitted=true;
    try {
      await sendEventEmail(params);
      expect(transport).toHaveBeenCalledTimes(1);
      outcome='rejected';
      const second={...params,to:'second@example.test'};
      const rejection = await sendEventEmail(second).catch(error => error);
      expect(rejection).toMatchObject({isRetryable:true,errorCode:providerKind === 'graph' ? 'ErrorTooManyRequests' : '429',metadata:{definitelyNotSent:true,retryAfterMs:17000}});
      expect((await table('ticket_comment_email_deliveries').where({recipient:second.to}).first()).state).toBe('failed');
      await queue.enqueue(second,{retryAfterMs:rejection.metadata.retryAfterMs}); await queue.enqueue(params);
      expect([...scores.values()].flatMap(values=>[...values.values()]).some(at=>at>Date.now()+16000)).toBe(true);
      outcome='success';
      await (queue as any).processReady();
      expect(transport).toHaveBeenCalledTimes(providerKind === 'graph' ? 3 : 6); // success + rejection(s) + recovered recipient
      expect((await table('ticket_comment_email_deliveries').where({recipient:second.to}).first())).toMatchObject({state:'sent',attempts:2});
      expect((await table('ticket_comment_email_deliveries').where({recipient}).first())).toMatchObject({state:'sent',attempts:1});
      const ambiguous=await makeComment(); const otherPdf=await upload(); await attach(otherPdf.file,ambiguous);
      outcome='unknown'; const unknown={...params,replyContext:{ticketId:ticket,commentId:ambiguous}};
      await expect(sendEventEmail(unknown)).rejects.toMatchObject({isRetryable:false,errorCode:'ECONNRESET'});
      const before=transport.mock.calls.length;
      await queue.enqueue(unknown); await (queue as any).processReady();
      expect(transport).toHaveBeenCalledTimes(before);
      expect((await table('ticket_comment_email_deliveries').where({comment_id:ambiguous}).first())).toMatchObject({state:'sending',requires_reconciliation:true,error_code:'ECONNRESET'});
      expect([...data.keys()].some(k=>k.includes('reconciliation:'))).toBe(true);
    } finally { await queue.shutdown(); connection.mockRestore();tenantConnection.mockRestore();storage.mockRestore();snapshot.mockRestore(); }
  });

  it('rechecks sponsor policy after persisted attachment reconstruction on delayed email retry', async () => {
    const { TenantEmailService } = await import('@alga-psa/email');
    const { SMTPEmailProvider } = await import('@alga-psa/email/providers/SMTPEmailProvider');
    const { coManagedDeliverySeam } = await import('@shared/lib/coManagedDelivery');
    const { CO_MANAGED_LEDGER } = await import('@shared/lib/deliveryLedger');
    const { sendEventEmail } = await import('@/lib/notifications/sendEventEmail');
    const pdf = await upload('sponsor-private.pdf'); await attach(pdf.file);
    await table('comments').where({ comment_id: comment }).update({ note: JSON.stringify([
      { type: 'paragraph', content: [{ type: 'text', text: 'Sponsor secret comment body' }] },
      ...JSON.parse(note(pdf.file)),
    ]) });
    await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en',
      subject: 'Update {{ticket.id}}', html_content: '{{{comment.content}}} {{ticket.metaLine}} {{ticket.requesterContact}} {{ticket.requesterDetails}} {{ticket.assignedDetails}} {{ticket.categoryDetails}} {{ticket.subcategory}}',
      text_content: '{{comment.text}} {{ticket.metaLine}} {{ticket.requesterContact}} {{ticket.requesterDetails}} {{ticket.assignedDetails}} {{ticket.categoryDetails}} {{ticket.subcategory}}' });
    const messages: any[] = [];
    const stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const provider = new SMTPEmailProvider('sponsor-retry');
    (provider as any).initialized = true; (provider as any).config = { from: 'agent@example.test' };
    (provider as any).transporter = { sendMail: async (mail: any) => {
      const sent = await stream.sendMail(mail); messages.push(await simpleParser(sent.message as Buffer)); return sent;
    } };
    const service = TenantEmailService.getInstance(tenant);
    const smtp = vi.spyOn(service as any, 'refreshProviderState').mockResolvedValue({ emailProvider: provider, providerInitError: null, fromAddress: 'agent@example.test' });
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const tenantConnection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: Buffer.from('%PDF-private') } as any);
    let redactedFields: string[] = [];
    let currentEmail = 'sponsor-current@example.test';
    let revoked = false;
    const sponsorTenant = randomUUID();
    await tenantDb(trx, sponsorTenant).unscoped('tenants', 'create isolated sponsor tenant').insert({ tenant: sponsorTenant, client_name: 'Sponsor', email: 'sponsor@example.test', product_code: 'psa' });
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    coManagedDeliverySeam.reset();
    coManagedDeliverySeam.register(() => ({ reauthorizeCommentRecipient: async () => revoked ? null : ({ kind: 'msp_user', principalId: actor, email: currentEmail, redactedFields }) }) as any);
    const pending = { mailClass: 'ticket' as const, tenantId: tenant, to: currentEmail, subject: 'Update', template: 'ticket-comment-added', locale: 'en' as const,
      context: { ticket: { id: 'ATT-1', title: 'Attachment tests', priority: 'Urgent', status: 'Open', metaLine: 'Ticket #ATT-1 · Urgent Priority · Open',
        requesterEmail: 'request@example.test', requesterContact: 'request@example.test', requesterDetails: 'Hidden Requester · request@example.test',
        assignedToName: 'Hidden Assignee', assignedDetails: 'Hidden Assignee (assignee@example.test)',
        categoryDetails: 'Hardware / Hidden Subcategory', subcategory: 'Hidden Subcategory' },
        comment: { content: 'Sponsor secret comment body', text: 'Sponsor secret comment body', author: 'Agent' } },
      replyContext: { ticketId: ticket, commentId: comment },
      delivery: { ledger: CO_MANAGED_LEDGER, ledgerTenant: sponsorTenant,
        key: { delivery_kind: 'ticket_comment_email', source_id: comment, recipient: 'sponsor-original@example.test' }, extra: { recipient_kind: 'msp_user' } },
      coManagedRecipient: { tenant, ticketId: ticket, commentId: comment, relationshipId: randomUUID(), sponsorTenant, principalId: actor } };
    const { EventEmailRetryQueue } = await import('@/lib/notifications/EventEmailRetryQueue');
    const { DelayedEmailQueue } = await import('@alga-psa/email');
    (EventEmailRetryQueue as any).instance = null;
    const data = new Map<string, string>(), scores = new Map<string, Map<string, number>>();
    const redis = { get: async (key: string) => data.get(key) ?? null, set: async (key: string, value: string) => { data.set(key, value); },
      del: async (key: string) => Number(data.delete(key)), zAdd: async (key: string, item: any) => { const z = scores.get(key) ?? new Map(); z.set(item.value, item.score); scores.set(key, z); return 1; },
      zRem: async (key: string, id: string) => Number(scores.get(key)?.delete(id)), zRangeByScore: async (key: string, min: number, max: number) => [...(scores.get(key) ?? new Map()).entries()].filter(([, score]) => score >= min && score <= max).map(([id]) => id),
      eval: async (script: string, args: any) => { const [source, processing] = args.keys, [id, expires] = args.arguments;
        if (script.startsWith('local ids')) return 0;
        if (scores.get(source)?.delete(id)) { const z = scores.get(processing) ?? new Map(); z.set(id, Number(expires)); scores.set(processing, z); return 1; } return 0; } };
    const retryQueue = EventEmailRetryQueue.getInstance({ checkIntervalMs: 3600000 });
    await retryQueue.initialize(async () => redis as any);
    (DelayedEmailQueue as any).instance = null;
    const delayedQueue = DelayedEmailQueue.getInstance({ checkIntervalMs: 3600000 });
    await delayedQueue.initialize(async () => redis as any);
    const rateLimit = vi.spyOn(service as any, 'checkRateLimits').mockResolvedValue({ allowed: false, retryAfterMs: 1, reason: 'test' });
    try {
      await expect(sendEventEmail(pending)).rejects.toMatchObject({ isRetryable: true });
      expect([...scores.entries()].some(([key, z]) => key.includes('ratelimit') && z.size > 0)).toBe(false);
      rateLimit.mockRestore();
      redactedFields = ['note', 'ticket_number', 'contact_email', 'values.assignee_name', 'subcategory_name'];
      currentEmail = 'sponsor-renamed@example.test';
      await retryQueue.enqueue(pending, { retryAfterMs: 1 });
      await new Promise(resolve => setTimeout(resolve, 5));
      await (retryQueue as any).processReady();
      expect(messages).toHaveLength(1);
      expect(messages[0].to.value[0].address).toBe(currentEmail);
      expect(messages[0].text).not.toContain('Sponsor secret comment body');
      expect(messages[0].text).not.toContain('ATT-1');
      expect(messages[0].text).not.toContain('Hidden Requester');
      expect(messages[0].text).not.toContain('request@example.test');
      expect(messages[0].text).not.toContain('Hidden Assignee');
      expect(messages[0].text).not.toContain('Hidden Subcategory');
      expect(messages[0].html).not.toContain('Hidden Requester');
      expect(messages[0].html).not.toContain('request@example.test');
      expect(messages[0].html).not.toContain('Hidden Assignee');
      expect(messages[0].html).not.toContain('Hidden Subcategory');
      expect(messages[0].attachments).toEqual([]);
      expect(await tenantDb(trx, sponsorTenant).table('co_management_deliveries')
        .where({ delivery_kind: 'ticket_comment_email', source_id: comment, recipient: 'sponsor-original@example.test' }).first()).toMatchObject({ state: 'sent' });
      const attachmentFreeComment = await makeComment({ note: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'Attachment-free source body' }] }]) });
      const attachmentFreePending = { ...pending, context: { ...pending.context, comment: { content: 'Attachment-free source body', text: 'Attachment-free source body', author: 'Agent' } },
        replyContext: { ticketId: ticket, commentId: attachmentFreeComment },
        coManagedRecipient: { ...pending.coManagedRecipient, commentId: attachmentFreeComment },
        delivery: { ...pending.delivery, key: { ...pending.delivery.key, source_id: attachmentFreeComment } } };
      redactedFields = [];
      currentEmail = 'sponsor-before-rate@example.test';
      const attachmentFreeRateLimit = vi.spyOn(service as any, 'checkRateLimits').mockResolvedValue({ allowed: false, retryAfterMs: 1, reason: 'test' });
      await expect(sendEventEmail(attachmentFreePending)).rejects.toMatchObject({ isRetryable: true });
      attachmentFreeRateLimit.mockRestore();
      redactedFields = ['note']; currentEmail = 'sponsor-after-rate@example.test';
      await retryQueue.enqueue(attachmentFreePending, { retryAfterMs: 1 });
      await new Promise(resolve => setTimeout(resolve, 5));
      await (retryQueue as any).processReady();
      expect(messages).toHaveLength(2);
      expect(messages[1].to.value[0].address).toBe(currentEmail);
      expect(messages[1].text).not.toContain('Attachment-free source body');
      expect(messages[1].attachments).toEqual([]);
      expect(await tenantDb(trx, sponsorTenant).table('co_management_deliveries')
        .where({ delivery_kind: 'ticket_comment_email', source_id: attachmentFreeComment, recipient: 'sponsor-original@example.test' }).first()).toMatchObject({ state: 'sent' });
      const revokedComment = await makeComment();
      const revokedPending = { ...pending, replyContext: { ticketId: ticket, commentId: revokedComment }, coManagedRecipient: { ...pending.coManagedRecipient, commentId: revokedComment },
        delivery: { ...pending.delivery, key: { ...pending.delivery.key, source_id: revokedComment } } };
      const revokedFail = vi.spyOn(service, 'sendEmail').mockResolvedValueOnce({ success: false, error: 'Rate limited', providerId: 'sponsor-retry', providerType: 'smtp',
        metadata: { retryable: true, definitelyNotSent: true, status: 429 } } as any);
      try { await expect(sendEventEmail(revokedPending)).rejects.toMatchObject({ isRetryable: true }); } finally { revokedFail.mockRestore(); }
      await retryQueue.enqueue(revokedPending, { retryAfterMs: 1 });
      revoked = true;
      await new Promise(resolve => setTimeout(resolve, 5));
      await (retryQueue as any).processReady();
      expect(messages).toHaveLength(2);
    } finally {
      await retryQueue.shutdown(); await delayedQueue.shutdown(); rateLimit.mockRestore(); smtp.mockRestore(); connection.mockRestore(); tenantConnection.mockRestore();
      coManagedDeliverySeam.reset(); delete process.env.FORCE_CAPABILITIES;
    }
  });

  it.each([false, true])('renders independent sponsor comment content from the ticket email subscriber (reverse=%s)', async reverse => {
    const { EmulatorHost } = await import('@alga-psa/emulator-host');
    const { default: smtpSink } = await import('@alga-psa/emulator-smtp-sink');
    const { coManagedDeliverySeam } = await import('@shared/lib/coManagedDelivery');
    const { ticketEmailSubscriberTestHarness } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber');
    const ids = { hidden: randomUUID(), visible: randomUUID() };
    const addresses = { [ids.hidden]: 'hidden-sponsor@example.test', [ids.visible]: 'visible-sponsor@example.test' };
    const policies: Record<string, string[]> = { [ids.hidden]: ['note', 'actor_display_name'], [ids.visible]: [] };
    const principals = reverse ? [ids.visible, ids.hidden] : [ids.hidden, ids.visible];
    const redactedFields = [{ kind: 'msp_user', principalId: ids.hidden, email: addresses[ids.hidden], redactedFields: policies[ids.hidden] },
      { kind: 'msp_user', principalId: ids.visible, email: addresses[ids.visible], redactedFields: policies[ids.visible] }];
    const sponsorTenant = randomUUID();
    await tenantDb(trx, sponsorTenant).unscoped('tenants', 'create isolated comment SMTP sponsor').insert({
      tenant: sponsorTenant, client_name: 'Comment SMTP Sponsor', email: 'sponsor@example.test', product_code: 'psa' });
    const plan = { audience: 'shared_it', threadId: randomUUID(), relationshipId: randomUUID(), sponsorTenant,
      sponsorRecipients: principals.map(id => redactedFields.find(r => r.principalId === id)),
      replyTokenMetadata: { namespace: 'cm', version: 2, relationshipId: randomUUID(), grantGeneration: 0, threadId: null } };
    await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Update {{ticket.id}}',
      html_content: '{{{comment.html}}}|{{comment.author}}|{{ticket.requesterDetails}}|{{ticket.assignedDetails}}|{{ticket.categoryDetails}}',
      text_content: '{{comment.text}}|{{comment.author}}|{{ticket.requesterDetails}}|{{ticket.assignedDetails}}|{{ticket.categoryDetails}}' });
    const customerMail = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const sponsorMail = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const customerPorts = await customerMail.start();
    const sponsorPorts = await sponsorMail.start();
    const settings = (port: number, providerId: string) => ({ tenant: providerId === 'customer' ? tenant : sponsorTenant,
      email_provider: 'smtp', default_from_domain: 'example.test', ticketing_from_email: 'agent@example.test',
      provider_configs: JSON.stringify([{ providerId, providerType: 'smtp', isEnabled: true,
        config: { host: '127.0.0.1', port, secure: false, rejectUnauthorized: false, from: 'agent@example.test' } }]) });
    await trx('tenant_email_settings').insert([
      settings(customerPorts.ports['smtp-sink'], 'customer'), settings(sponsorPorts.ports['smtp-sink'], 'sponsor'),
    ]);
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const tenantConnection = vi.spyOn(dbModule, 'createTenantKnex').mockImplementation(async (requestedTenant: string) => ({ knex: trx, tenant: requestedTenant } as any));
    const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
    const secretProvider = await getSecretProviderInstance();
    const getSecret = secretProvider.getAppSecret.bind(secretProvider);
    const secret = vi.spyOn(secretProvider, 'getAppSecret').mockImplementation(async name =>
      name.toLowerCase() === 'nextauth_secret' ? 'co-managed-comment-smtp-test-secret' : getSecret(name));
    process.env.FORCE_CAPABILITIES = 'co-managed:on';
    coManagedDeliverySeam.reset();
    coManagedDeliverySeam.register(() => ({ planTicketComment: async () => plan,
      reauthorizeCommentRecipient: async (input: any) => redactedFields.find(r => r.principalId === input.principalId) ?? null }) as any);
    try {
      await ticketEmailSubscriberTestHarness.handleTicketCommentAdded({ id: randomUUID(), eventType: 'TICKET_COMMENT_ADDED', payload: {
        tenantId: tenant, ticketId: ticket, actorUserId: actor,
        comment: { id: comment, content: JSON.stringify([{ type: 'paragraph', content: [{ type: 'text', text: 'One recipient secret body' }] }]), author: 'Hidden Author', isInternal: false },
      } } as any);
      const customerMessages = await (await fetch(`http://127.0.0.1:${customerPorts.controlPort}/control/smtp-sink/state/emails`)).json() as any;
      const sponsorMessages = await (await fetch(`http://127.0.0.1:${sponsorPorts.controlPort}/control/smtp-sink/state/emails`)).json() as any;
      const messages = customerMessages.result.map((message: any) => ({ ...message, text: message.text ?? '', html: message.html ?? '' }));
      expect(messages).toHaveLength(2);
      expect(sponsorMessages.result).toHaveLength(0);
      expect(messages.map((message: any) => message.to.join(',')).sort()).toEqual(Object.values(addresses).sort());
      const hidden = messages.find((m: any) => m.to.includes(addresses[ids.hidden]));
      const visible = messages.find((m: any) => m.to.includes(addresses[ids.visible]));
      expect(hidden.text).not.toContain('One recipient secret body');
      expect(hidden.text).not.toContain('Hidden Author');
      expect(visible.text).toContain('One recipient secret body');
      expect(visible.text).toContain('Hidden Author');
    } finally {
      secret.mockRestore(); connection.mockRestore(); tenantConnection.mockRestore();
      coManagedDeliverySeam.reset(); delete process.env.FORCE_CAPABILITIES;
      await customerMail.stop(); await sponsorMail.stop();
    }
  });

  it('routes a rate-limited sponsor routing email through ledger recovery with current recipient content', async () => {
    const { TenantEmailService, DelayedEmailQueue } = await import('@alga-psa/email');
    const { SMTPEmailProvider } = await import('@alga-psa/email/providers/SMTPEmailProvider');
    const { deliverRoutingRow } = await import('@/lib/notifications/coManagedRoutingDelivery');
    const sourceId = randomUUID(), originalEmail = 'routing-original@example.test', currentEmail = 'routing-current@example.test';
    await table('co_management_deliveries').insert({ tenant, delivery_kind: 'routing_email', source_id: sourceId, recipient: originalEmail,
      recipient_kind: 'msp_user', state: 'pending', attempts: 0 });
    await table('tenant_email_templates').insert({ tenant, name: 'co-managed-routing', language_code: 'en', subject: '{{routing.headline}}',
      html_content: '{{routing.body}} {{ticket.id}}', text_content: '{{routing.body}} {{ticket.id}}' });
    const messages: any[] = [], stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const provider = new SMTPEmailProvider('routing-retry');
    (provider as any).initialized = true; (provider as any).config = { from: 'agent@example.test' };
    (provider as any).transporter = { sendMail: async (mail: any) => { const sent = await stream.sendMail(mail); messages.push(await simpleParser(sent.message as Buffer)); return sent; } };
    const service = TenantEmailService.getInstance(tenant);
    const refresh = vi.spyOn(service as any, 'refreshProviderState').mockResolvedValue({ emailProvider: provider, providerInitError: null, fromAddress: 'agent@example.test' });
    const rate = vi.spyOn(service as any, 'checkRateLimits').mockResolvedValueOnce({ allowed: false, retryAfterMs: 1, reason: 'test' })
      .mockResolvedValue({ allowed: true });
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const tenantConnection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    (DelayedEmailQueue as any).instance = null;
    const data = new Map<string, string>(), scores = new Map<string, Map<string, number>>();
    const redis = { get: async (key: string) => data.get(key) ?? null, set: async (key: string, value: string) => { data.set(key, value); },
      del: async (key: string) => Number(data.delete(key)), zAdd: async (key: string, item: any) => { const z = scores.get(key) ?? new Map(); z.set(item.value, item.score); scores.set(key, z); return 1; },
      zRem: async (key: string, id: string) => Number(scores.get(key)?.delete(id)), zRangeByScore: async (key: string, min: number, max: number) => [...(scores.get(key) ?? new Map()).entries()].filter(([, score]) => score >= min && score <= max).map(([id]) => id),
      eval: async (script: string, args: any) => { if (script.startsWith('local ids')) return 0; return 0; } };
    const delayed = DelayedEmailQueue.getInstance({ checkIntervalMs: 3600000 }); await delayed.initialize(async () => redis as any);
    const route = (email: string, redactedFields: string[]) => ({ tenant, deliveryKind: 'routing_email', sourceId, event: 'escalation_received' as const,
      recipient: { kind: 'msp_user' as const, principalId: actor, email, redactedFields }, ledgerRecipient: originalEmail,
      recipientTenant: tenant, ticketId: ticket, ticketNumber: 'R-41', ticketTitle: 'Restricted routing title', actorName: 'Routing actor', actorOrganization: 'Sponsor Org', allowed: true });
    try {
      expect(await deliverRoutingRow(route(originalEmail, []))).toBe('failed');
      expect((await table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: sourceId }).first()).state).toBe('failed');
      expect([...scores.entries()].some(([key, z]) => key.includes('ratelimit') && z.size > 0)).toBe(false);
      expect(await deliverRoutingRow(route(currentEmail, ['ticket_number', 'tickets.title', 'actor_organization_name']))).toBe('sent');
      expect(messages).toHaveLength(1);
      expect(messages[0].to.value[0].address).toBe(currentEmail);
      expect(messages[0].text).not.toContain('R-41');
      expect(messages[0].text).not.toContain('Restricted routing title');
      expect(messages[0].text).not.toContain('Routing actor');
      expect(messages[0].text).not.toContain('Sponsor Org');
      expect(messages[0].html).not.toContain('Routing actor');
      expect(messages[0].html).not.toContain('Sponsor Org');
      expect((await table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: sourceId }).first())
        .recipient).toBe(originalEmail);
      expect((await table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: sourceId }).first()).state).toBe('sent');
      const revokedSource = randomUUID();
      await table('co_management_deliveries').insert({ tenant, delivery_kind: 'routing_email', source_id: revokedSource, recipient: originalEmail,
        recipient_kind: 'msp_user', state: 'pending', attempts: 0 });
      expect(await deliverRoutingRow({ ...route(currentEmail, []), sourceId: revokedSource, allowed: false })).toBe('skipped');
      expect(messages).toHaveLength(1);
      expect((await table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: revokedSource }).first())
        .error_code).toBe('recipient_not_permitted');
    } finally {
      await delayed.shutdown(); rate.mockRestore(); refresh.mockRestore(); connection.mockRestore(); tenantConnection.mockRestore();
    }
  });

  it('production routing recovery reauthorizes changed sponsor identity and policy against the captured ledger row', async () => {
    const { TenantEmailService } = await import('@alga-psa/email');
    const { SMTPEmailProvider } = await import('@alga-psa/email/providers/SMTPEmailProvider');
    const { createCoManagedDeliveryProvider } = await import('../../../../packages/co-managed/src/deliveryProvider');
    const sponsor = tenant, customer = randomUUID(), sponsorUser = randomUUID(), customerUser = randomUUID();
    const sponsorClient = randomUUID(), customerClient = randomUUID(), sponsorBoard = randomUUID(), customerBoard = randomUUID();
    const relationship = randomUUID(), sourceId = randomUUID(), ticketId = randomUUID(), workId = randomUUID();
    const roleId = randomUUID(), permissionId = randomUUID(), originalEmail = 'captured-route@example.test';
    const currentEmail = 'current-sponsor-route@example.test';
    await tenantDb(trx, customer).unscoped('tenants', 'create isolated routing-recovery fixture customer').insert({
      tenant: customer, client_name: 'Routing Recovery Customer', email: 'customer@routing-recovery.test', product_code: 'co_managed' });
    await tenantDb(trx, sponsor).table('clients').insert({ tenant: sponsor, client_id: sponsorClient, client_name: 'Routing Recovery Customer', client_type: 'company' });
    await tenantDb(trx, customer).table('clients').insert({ tenant: customer, client_id: customerClient, client_name: 'Routing Recovery Customer', client_type: 'company' });
    await tenantDb(trx, sponsor).table('boards').insert({ tenant: sponsor, board_id: sponsorBoard, board_name: 'Routing Recovery', is_inactive: false });
    await tenantDb(trx, customer).table('boards').insert({ tenant: customer, board_id: customerBoard, board_name: 'Customer Routing', is_inactive: false });
    await tenantDb(trx, sponsor).table('users').insert({ tenant: sponsor, user_id: sponsorUser, username: 'routing-recovery-sponsor',
      email: originalEmail, hashed_password: 'unused', first_name: 'Fixture', last_name: 'Sponsor', user_type: 'internal', is_inactive: false });
    await tenantDb(trx, customer).table('users').insert({ tenant: customer, user_id: customerUser, username: 'routing-recovery-customer',
      email: 'customer@routing-recovery.test', hashed_password: 'unused', first_name: 'Fixture', last_name: 'Customer', user_type: 'internal', is_inactive: false });
    await tenantDb(trx, sponsor).table('roles').insert({ tenant: sponsor, role_id: roleId, role_name: 'Routing recovery ticket reader', msp: true, client: false });
    await tenantDb(trx, sponsor).table('permissions').insert({ tenant: sponsor, permission_id: permissionId, resource: 'ticket', action: 'read', msp: true, client: false });
    await tenantDb(trx, sponsor).table('role_permissions').insert({ tenant: sponsor, role_id: roleId, permission_id: permissionId });
    await tenantDb(trx, sponsor).table('user_roles').insert({ tenant: sponsor, user_id: sponsorUser, role_id: roleId });
    const bundleId = randomUUID(), revisionId = randomUUID(), ruleId = randomUUID(), assignmentId = randomUUID();
    await tenantDb(trx, sponsor).table('authorization_bundles').insert({ tenant: sponsor, bundle_id: bundleId, name: 'Routing recovery recipient policy',
      status: 'active', published_revision_id: null });
    await tenantDb(trx, sponsor).table('authorization_bundle_revisions').insert({ tenant: sponsor, revision_id: revisionId, bundle_id: bundleId,
      revision_number: 1, lifecycle_state: 'published', published_at: new Date() });
    await tenantDb(trx, sponsor).table('authorization_bundles').where({ bundle_id: bundleId }).update({ published_revision_id: revisionId });
    await tenantDb(trx, sponsor).table('authorization_bundle_rules').insert({ tenant: sponsor, rule_id: ruleId, bundle_id: bundleId, revision_id: revisionId,
      resource_type: 'ticket', action: 'read', template_key: 'selected_clients', constraint_key: null, effect: 'narrow',
      config: { selectedClientIds: [sponsorClient], redactedFields: [] } });
    await tenantDb(trx, sponsor).table('authorization_bundle_assignments').insert({ tenant: sponsor, assignment_id: assignmentId, bundle_id: bundleId,
      target_type: 'user', target_id: sponsorUser, status: 'active' });
    await tenantDb(trx, customer).table('co_management_relationships').insert({ tenant: customer, relationship_id: relationship, sponsor_tenant: sponsor,
      sponsor_client_id: sponsorClient, state: 'active', visibility_mode: 'escalation_only', accepted_by: customerUser, accepted_at: new Date(),
      redacted_fields: ['ticket_number', 'actor_display_name'] });
    await tenantDb(trx, sponsor).table('co_management_staff_assignments').insert({ tenant: sponsor, customer_tenant: customer, relationship_id: relationship,
      principal_type: 'user', principal_id: sponsorUser, relationship_role: 'technician' });
    await tenantDb(trx, customer).table('tickets').insert({ tenant: customer, ticket_id: ticketId, ticket_number: 'RECOVERY-41', title: 'Recovery private title',
      client_id: customerClient, board_id: customerBoard, entered_by: customerUser, entered_at: new Date(), updated_at: new Date(), is_closed: false });
    await tenantDb(trx, customer).table('co_management_ticket_work').insert({ tenant: customer, relationship_id: relationship, ticket_id: ticketId, work_id: workId,
      revision: 1, responsibility: 'msp', can_collaborate: true, first_escalated_at: new Date(), last_transition_at: new Date() });
    await tenantDb(trx, sponsor).table('co_managed_ticket_references').insert({ tenant: sponsor, reference_id: randomUUID(), customer_tenant: customer,
      relationship_id: relationship, ticket_id: ticketId, work_id: workId, client_id: sponsorClient, board_id: sponsorBoard, assigned_to: sponsorUser,
      created_at: new Date(), updated_at: new Date() });
    const payload = { ticketId, principalId: sponsorUser, event: 'escalation_received', actorName: 'Policy Hidden Actor', actorOrganization: 'Policy Hidden Org',
      sponsorTenant: sponsor, relationshipId: relationship };
    await tenantDb(trx, customer).table('co_management_deliveries').insert({ tenant: customer, delivery_kind: 'routing_email', source_id: sourceId,
      recipient: originalEmail, recipient_kind: 'msp_user', state: 'pending', attempts: 0, payload });
    await table('tenant_email_templates').insert({ tenant: sponsor, name: 'co-managed-routing', language_code: 'en', subject: '{{routing.headline}}',
      html_content: '{{routing.body}} {{ticket.id}}', text_content: '{{routing.body}} {{ticket.id}}' });

    const messages: any[] = [], stream = nodemailer.createTransport({ streamTransport: true, buffer: true });
    const emailProvider = new SMTPEmailProvider('production-routing-recovery');
    (emailProvider as any).initialized = true; (emailProvider as any).config = { from: 'agent@example.test' };
    (emailProvider as any).transporter = { sendMail: async (mail: any) => {
      const sent = await stream.sendMail(mail); messages.push(await simpleParser(sent.message as Buffer)); return sent;
    } };
    const service = TenantEmailService.getInstance(sponsor);
    const refresh = vi.spyOn(service as any, 'refreshProviderState').mockResolvedValue({ emailProvider, providerInitError: null, fromAddress: 'agent@example.test' });
    const rate = vi.spyOn(service as any, 'checkRateLimits').mockResolvedValueOnce({ allowed: false, retryAfterMs: 1, reason: 'test initial failure' }).mockResolvedValue({ allowed: true });
    const dbWrapper = vi.spyOn(dbModule, 'withAdminTransaction').mockImplementation(async (callback: any) => callback(trx));
    const connection = vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    const tenantConnection = vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant: sponsor } as any);
    const deliveryProvider = createCoManagedDeliveryProvider();
    try {
      const initial = await deliveryProvider.pendingRouting(customer);
      expect(initial).toHaveLength(1);
      expect(initial[0]).toMatchObject({ allowed: true, ledgerRecipient: originalEmail, recipient: { email: originalEmail } });
      expect(await (await import('@/lib/notifications/coManagedRoutingDelivery')).deliverRouting(deliveryProvider, customer)).toMatchObject({ failed: 1 });
      expect((await tenantDb(trx, customer).table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: sourceId }).first()).state).toBe('failed');

      await tenantDb(trx, sponsor).table('users').where({ user_id: sponsorUser }).update({ email: ` ${currentEmail.toUpperCase()} ` });
      await tenantDb(trx, sponsor).table('authorization_bundle_rules').where({ rule_id: ruleId }).update({
        config: { selectedClientIds: [sponsorClient], redactedFields: ['tickets.title', 'actor_organization_name'] },
      });
      const retried = await deliveryProvider.pendingRouting(customer);
      expect(retried[0]).toMatchObject({ allowed: true, ledgerRecipient: originalEmail, recipient: {
        email: currentEmail, principalId: sponsorUser, redactedFields: ['tickets.title', 'actor_organization_name', 'ticket_number', 'actor_display_name'],
      } });
      expect(await (await import('@/lib/notifications/coManagedRoutingDelivery')).deliverRouting(deliveryProvider, customer)).toMatchObject({ sent: 1 });
      expect(messages).toHaveLength(1);
      expect(messages[0].to.value[0].address).toBe(currentEmail);
      expect(messages[0].text).not.toContain('RECOVERY-41');
      expect(messages[0].text).not.toContain('Recovery private title');
      expect(messages[0].text).not.toContain('Policy Hidden Actor');
      expect(messages[0].text).not.toContain('Policy Hidden Org');
      const completed = await tenantDb(trx, customer).table('co_management_deliveries').where({ delivery_kind: 'routing_email', source_id: sourceId }).first();
      expect(completed).toMatchObject({ recipient: originalEmail, state: 'sent', attempts: 2 });
    } finally {
      dbWrapper.mockRestore(); rate.mockRestore(); refresh.mockRestore(); connection.mockRestore(); tenantConnection.mockRestore();
    }
  });

  it('live PgBoss discovery reuses workers and recovers a committed publication to SMTP once', async () => {
    const { default: PgBoss } = await import('pg-boss');
    const { EmulatorHost } = await import('@alga-psa/emulator-host');
    const { default: smtpSink } = await import('@alga-psa/emulator-smtp-sink');
    const mailHost = new EmulatorHost({ emulators: [smtpSink], controlPort: 0, ports: { 'smtp-sink': 0 } });
    const { PgBossJobRunner } = await import('@/lib/jobs/runners/PgBossJobRunner');
    const factory = await import('@/lib/jobs/JobRunnerFactory');
    const { initializeJobRunner } = await import('@/lib/jobs/initializeJobRunner');
    const { createCommentRecoveryScheduleDiscovery } = await import('@/lib/jobs/commentRecoveryScheduleDiscovery');
    const { registerAllJobHandlers } = await import('@/lib/jobs/registerAllHandlers');
    const { JobHandlerRegistry } = await import('@/lib/jobs/jobHandlerRegistry');
    const { JobService } = await import('@/services/job.service');
    const { SMTPEmailProvider } = await import('@alga-psa/email/providers/SMTPEmailProvider');
    const { TenantEmailService } = await import('@alga-psa/email');
    const { sendEventEmail } = await import('@/lib/notifications/sendEventEmail');
    const publishers = await import('@alga-psa/event-bus/publishers');
    const schema = `worker_smoke_${randomUUID().replaceAll('-', '')}`;
    const boss = new PgBoss({ schema, pollingIntervalSeconds: 0.5, db: {
      async executeSql(sql, values) {
        const connection = await conn.client.acquireConnection();
        try { return await connection.query(sql, values); }
        finally { await conn.client.releaseConnection(connection); }
      },
    } });
    const errors: unknown[] = [];
    boss.on('error', error => errors.push(error));
    const provider = new SMTPEmailProvider('local-worker-recovery-smoke');
    const bytes = Buffer.from('%PDF-1.4 worker recovery smoke');
    const filename = `worker-recovery-${comment}.pdf`;
    const mailbox = `worker-recovery-${comment}@example.test`;
    const restores: Array<() => void> = [];
    const spy = (mock: { mockRestore(): void }) => { restores.push(() => mock.mockRestore()); return mock; };
    let committed = false;
    try {
      const { controlPort, ports } = await mailHost.start();
      await table('contacts').where({ client_id: client }).update({ email: mailbox });
      await table('users').where({ user_id: clientUser }).update({ email: mailbox });
      const pdf = await upload(filename, 'application/pdf', bytes.length); await attach(pdf.file);
      await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Worker recovery', html_content: '{{{comment.content}}}', text_content: '{{comment.text}}' });
      await persistCommentPublication(trx, { payload: { tenantId: tenant, ticketId: ticket, commentId: comment, userId: actor } });
      await trx.commit(); committed = true;
      spy(vi.spyOn(dbModule, 'getConnection').mockResolvedValue(conn));
      spy(vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: conn, tenant } as any));
      spy(vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: bytes } as any));
      await provider.initialize({ host: '127.0.0.1', port: ports['smtp-sink'], secure: false, from: 'agent@example.test' });
      spy(vi.spyOn(TenantEmailService.getInstance(tenant) as any, 'refreshProviderState').mockResolvedValue({ emailProvider: provider, providerInitError: null, fromAddress: 'agent@example.test' }));
      await boss.start();
      // Use a dedicated real PgBoss transport/schema; the factory boundary is
      // substituted only to avoid touching any existing scheduler's queues.
      const runner = new (PgBossJobRunner as any)(boss, await JobService.create(), new StorageService());
      spy(vi.spyOn(factory, 'getJobRunner').mockResolvedValue(runner));
      // Schedule installation is covered separately against PostgreSQL. Here
      // manually dispatch only this tenant's recovery job, never other tenants.
      spy(vi.spyOn(runner, 'scheduleRecurringJob').mockResolvedValue({ jobId: randomUUID() }));
      await registerAllJobHandlers({ includeEnterprise: false });
      for (const name of JobHandlerRegistry.getAll().keys()) await boss.createQueue(name);
      const registrations = vi.spyOn(boss, 'work');
      const discovery = createCommentRecoveryScheduleDiscovery(initializeJobRunner);
      await discovery.tick(); await discovery.tick(); await discovery.tick();
      for (const name of JobHandlerRegistry.getAll().keys()) {
        expect(registrations.mock.calls.filter(([queue]) => queue === name), name).toHaveLength(1);
      }
      const publish = vi.spyOn(publishers, 'publishStoredWorkflowEvent')
        .mockRejectedValueOnce(new Error('Recoverable publication transport outage'))
        .mockImplementation(async () => sendEventEmail({ mailClass: 'ticket', tenantId: tenant, to: mailbox, subject: 'Worker recovery', template: 'ticket-comment-added', context: { comment: { content: 'Recovery smoke' } }, replyContext: { ticketId: ticket, commentId: comment } }));
      spy(publish);
      const runRecovery = async () => {
        const id = await boss.send('recover-comment-publications', { tenantId: tenant });
        await vi.waitFor(async () => expect((await boss.getJobById('recover-comment-publications', id!))?.state).toBe('completed'), { timeout: 15000, interval: 100 });
      };
      const stored = () => tenantDb(conn, tenant).table('comments').where({ comment_id: comment }).first();
      const eventId = (await stored()).scheduled_publish_event_id;
      await runRecovery(); expect((await stored()).scheduled_publish_dispatched_at).toBeNull();
      await runRecovery(); expect((await stored()).scheduled_publish_dispatched_at).toBeTruthy();
      await runRecovery();
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls.every(call => call[1]?.eventId === eventId)).toBe(true);
      expect(await tenantDb(conn, tenant).table('ticket_comment_email_deliveries').where({ comment_id: comment, recipient: mailbox }).first()).toMatchObject({ state: 'sent', attempts: 1 });
      const receipt = await (await fetch(`http://127.0.0.1:${controlPort}/control/smtp-sink/state/emails`)).json() as {
        result: Array<{ to: string[]; attachments: Array<{ filename: string; contentType: string; contentBase64: string }> }>;
      };
      const messages = receipt.result.filter(message => message.to.includes(mailbox));
      expect(messages).toHaveLength(1);
      expect(messages[0].attachments).toHaveLength(1);
      expect(messages[0].attachments[0]).toMatchObject({ filename, contentType: 'application/pdf' });
      expect(Buffer.from(messages[0].attachments[0].contentBase64, 'base64').equals(bytes)).toBe(true);
      expect(errors).toEqual([]);
      console.log(`Live PgBoss: ${registrations.mock.calls.length} handlers registered once over three ticks; failed committed publication recovered with one SMTP PDF delivery.`);
    } finally {
      await boss.stop({ graceful: true });
      (provider as any).transporter?.close();
      await mailHost.stop();
      for (const restore of restores.reverse()) restore();
      await conn.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
      if (committed) {
        for (const name of ['email_reply_tokens', 'email_sending_logs', 'ticket_comment_email_deliveries', 'tenant_email_templates', 'ticket_comment_attachments', 'comments', 'comment_threads', 'document_associations', 'documents', 'external_files', 'tickets', 'users', 'contacts', 'client_billing_profiles', 'clients']) {
          await tenantDb(conn, tenant).table(name).delete();
        }
        await tenantDb(conn, tenant).unscoped('tenants', 'remove isolated worker smoke tenant').where({ tenant }).delete();
      }
    }
  }, 60000);

  it('scheduled handler commits publication and retries failed dispatch with the same ID', async () => {
    const publishers=await import('@alga-psa/event-bus/publishers');
    const pdf=await upload();await attach(pdf.file);
    await table('comments').where({comment_id:comment}).update({publish_state:'scheduled',scheduled_publish_at:new Date(Date.now()-60000)});
    await table('tickets').where({ticket_id:ticket}).update({response_state:'awaiting_client'});
    expect(await listPublishedCommentAttachments(trx,tenant,ticket,comment)).toEqual([]);
    const connection=vi.spyOn(dbModule,'getConnection').mockResolvedValue(trx);
    const publish=vi.spyOn(publishers,'publishBuiltWorkflowPayload').mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(undefined);
    try {
      const {publishScheduledCommentHandler}=await import('@/lib/jobs/handlers/publishScheduledCommentHandler');
      await expect(publishScheduledCommentHandler({tenantId:tenant,ticketId:ticket,commentId:comment})).rejects.toThrow('Redis unavailable');
      const pending=await table('comments').where({comment_id:comment}).first();
      expect(pending.publish_state).toBe('published');expect(pending.scheduled_publish_dispatched_at).toBeNull();
      await publishScheduledCommentHandler({tenantId:tenant,ticketId:ticket,commentId:comment});
      await publishScheduledCommentHandler({tenantId:tenant,ticketId:ticket,commentId:comment});
      expect(publish).toHaveBeenCalledTimes(2);
      expect(publish.mock.calls[0][1]?.eventId).toBe(publish.mock.calls[1][1]?.eventId);
      expect(await listPublishedCommentAttachments(trx,tenant,ticket,comment)).toHaveLength(1);
    } finally {connection.mockRestore();publish.mockRestore();}
  });
  it('guest download POST requires the delivered code and denies revoked or expired links without an account', async () => {
    const {TenantEmailService}=await import('@alga-psa/email');
    const {GET,POST}=await import('@/app/api/ticket-comment-attachments/download/route');
    const pdf=await upload();await attach(pdf.file);
    await table('users').where({user_id:clientUser}).delete();routeSession.user=null;
    const connection=vi.spyOn(dbModule,'createTenantKnex').mockResolvedValue({knex:trx,tenant} as any);
    const storage=vi.spyOn(StorageService,'downloadFile').mockResolvedValue({buffer:Buffer.from('%PDF-guest')} as any);
    let code='';
    const send=vi.spyOn(TenantEmailService.getInstance(tenant),'sendEmail').mockImplementation(async params=>{
      expect(params.to).toBe(recipient);
      const rendered=await params.templateProcessor!.process({});
      code=rendered.text!.match(/code is (\d{6})/)![1];return {success:true};
    });
    try {
      const secret=await attachmentSigningSecret();
      const claims={tenant,ticketId:ticket,commentId:comment,documentId:pdf.document,recipient,expiresAt:Date.now()+3600000};
      const token=signAttachmentLink(claims,secret);
      const post=(action:string,entered='',cookie='',signed=token)=>{
        const body=new FormData();body.set('token',signed);body.set('action',action);body.set('code',entered);
        return new NextRequest('http://localhost/api/ticket-comment-attachments/download',{method:'POST',body,headers:{origin:'http://localhost',...(cookie?{cookie}: {})}});
      };
      const page=await GET(new NextRequest('http://localhost/api/ticket-comment-attachments/download?token='+encodeURIComponent(token)));
      expect(page.headers.get('referrer-policy')).toBe('same-origin');
      const challenge=await POST(post('send'));expect(challenge.status).toBe(200);expect(send).toHaveBeenCalledOnce();
      const cookie=challenge.headers.get('set-cookie')!.split(';')[0];
      expect((await POST(post('verify',code))).status).toBe(403);
      const response=await POST(post('verify',code,cookie));expect(response.status).toBe(200);expect(await response.text()).toBe('%PDF-guest');
      expect((await POST(post('verify',code,cookie))).status).toBe(403);
      expect((await POST(post('send','','',signAttachmentLink({...claims,expiresAt:0},secret)))).status).toBe(403);
      await table('documents').where({document_id:pdf.document}).update({is_client_visible:false});
      expect((await POST(post('send'))).status).toBe(403);expect(send).toHaveBeenCalledOnce();
    } finally {connection.mockRestore();storage.mockRestore();send.mockRestore();}
  });

  describe('record-scoped ticket authorization', () => {
    let board: string, ownContact: string, siblingContact: string, group: string, ownTicket: string, siblingTicket: string;
    let ownUser: string;
    const mkUser = async (contactId: string | null, type = 'client') => {
      const id = randomUUID();
      await table('users').insert({tenant,user_id:id,username:id,email:`${id}@example.test`,hashed_password:'unused',user_type:type,contact_id:contactId,is_inactive:false});
      return id;
    };
    const mkTicket = async (contact: string | null, extra: Record<string, unknown> = {}) => {
      const id = randomUUID();
      await table('tickets').insert({tenant,ticket_id:id,ticket_number:`SC-${id.slice(0,6)}`,client_id:client,board_id:board,contact_name_id:contact,title:'scoped',entered_by:actor,...extra});
      return id;
    };
    /** A published public comment with one attached file on the given ticket. */
    const publicAttachment = async (ticketId: string) => {
      const comment = randomUUID(), thread = randomUUID(), document = randomUUID(), file = randomUUID();
      await table('comment_threads').insert({tenant,thread_id:thread,ticket_id:ticketId,root_comment_id:comment,is_internal:false,created_by:actor});
      await table('comments').insert({tenant,comment_id:comment,thread_id:thread,ticket_id:ticketId,user_id:actor,author_type:'internal',note:'[]',is_internal:false,is_resolution:false});
      await table('external_files').insert({tenant,file_id:file,file_name:'a.pdf',original_name:'a.pdf',mime_type:'application/pdf',file_size:12,storage_path:`/test/${file}`,uploaded_by_id:actor});
      await table('documents').insert({tenant,document_id:document,file_id:file,document_name:'a.pdf',mime_type:'application/pdf',file_size:12,user_id:actor,created_by:actor,is_client_visible:true});
      await table('document_associations').insert({tenant,document_id:document,entity_type:'ticket',entity_id:ticketId});
      await table('ticket_comment_attachments').insert({tenant,document_id:document,ticket_id:ticketId,comment_id:comment,state:'attached',created_by:actor,expires_at:new Date(Date.now()+86400000)});
      return {document,file,comment};
    };
    const asClient = async (userId: string) => ({ ...await table('users').where({user_id:userId}).first(), clientId:client });
    beforeEach(async () => {
      board = randomUUID(); ownContact = randomUUID(); siblingContact = randomUUID(); group = randomUUID();
      await table('boards').insert({tenant,board_id:board,board_name:'Support'});
      await table('contacts').insert([
        {tenant,contact_name_id:ownContact,client_id:client,full_name:'Own',email:'own@example.test'},
        {tenant,contact_name_id:siblingContact,client_id:client,full_name:'Sibling',email:'sib@example.test'},
      ]);
      await table('client_portal_visibility_groups').insert({tenant,group_id:group,client_id:client,name:'Own tickets',ticket_scope:'contact'});
      await table('client_portal_visibility_group_boards').insert({tenant,group_id:group,board_id:board});
      await table('contacts').where({contact_name_id:ownContact}).update({portal_visibility_group_id:group});
      ownUser = await mkUser(ownContact);
      ownTicket = await mkTicket(ownContact); siblingTicket = await mkTicket(siblingContact);
    });

    it('denies a contact-scoped client a sibling contact ticket attachment, through both the attachment and document paths', async () => {
      const sibling = await publicAttachment(siblingTicket), own = await publicAttachment(ownTicket);
      expect(await canReadCommentAttachment(trx,tenant,ownUser,sibling.document)).toBe(false);
      const user = await asClient(ownUser);
      expect(await getAuthorizedDocumentByFileId(trx,tenant,user,sibling.file)).toBeNull();
      expect(await getAuthorizedDocumentById(trx,tenant,user,sibling.document)).toBeNull();
      expect(await filterReadableCommentAttachments(trx,tenant,ownUser,[{document_id:sibling.document},{document_id:own.document}]))
        .toEqual([{document_id:own.document}]);
      // Their own ticket is still readable.
      expect(await canReadCommentAttachment(trx,tenant,ownUser,own.document)).toBe(true);
      expect(await getAuthorizedDocumentByFileId(trx,tenant,user,own.file)).toMatchObject({ document_id: own.document });
    });

    it('allows client scope, manager, watcher and billing-profile grants where the visibility predicate does', async () => {
      const sibling = await publicAttachment(siblingTicket);
      // client-scoped contact sees the sibling ticket
      const clientScopedContact = randomUUID();
      await table('client_portal_visibility_groups').where({group_id:group}).update({ticket_scope:'client'});
      await table('contacts').insert({tenant,contact_name_id:clientScopedContact,client_id:client,full_name:'CS',email:'cs@example.test',portal_visibility_group_id:group});
      const csUser = await mkUser(clientScopedContact);
      expect(await canReadCommentAttachment(trx,tenant,csUser,sibling.document)).toBe(true);
      await table('client_portal_visibility_groups').where({group_id:group}).update({ticket_scope:'contact'});
      expect(await canReadCommentAttachment(trx,tenant,csUser,sibling.document)).toBe(false);
      // manager grant: the sibling reports to the own contact
      await table('contacts').where({contact_name_id:siblingContact}).update({manager_contact_id:clientScopedContact});
      expect(await canReadCommentAttachment(trx,tenant,csUser,sibling.document)).toBe(true);
      await table('contacts').where({contact_name_id:siblingContact}).update({manager_contact_id:null});
      // watcher grant
      await table('tickets').where({ticket_id:siblingTicket}).update({attributes:JSON.stringify({watch_list:[{entity_type:'contact',entity_id:clientScopedContact,active:true}]})});
      expect(await canReadCommentAttachment(trx,tenant,csUser,sibling.document)).toBe(true);
      await table('tickets').where({ticket_id:siblingTicket}).update({attributes:JSON.stringify({watch_list:[{entity_type:'contact',entity_id:clientScopedContact,active:false}]})});
      expect(await canReadCommentAttachment(trx,tenant,csUser,sibling.document)).toBe(false);
    });

    it('denies a client a ticket on a board outside its visibility group', async () => {
      const other = randomUUID();
      await table('boards').insert({tenant,board_id:other,board_name:'Hidden'});
      const hidden = await mkTicket(ownContact, { board_id: other });
      expect(await canAccessAttachmentTicket(trx,tenant,ownUser,hidden)).toBe(false);
      expect(await canWriteAttachmentTicket(trx,tenant,ownUser,hidden)).toBe(false);
      expect(await canAccessAttachmentTicket(trx,tenant,ownUser,ownTicket)).toBe(true);
    });

    it('record-restricted MSP users are denied; unrestricted internal users are allowed', async () => {
      const sibling = await publicAttachment(siblingTicket);
      const restricted = await mkUser(null, 'internal');
      expect(await canReadCommentAttachment(trx,tenant,restricted,sibling.document)).toBe(true);
      const otherClient = randomUUID();
      await table('clients').insert({tenant,client_id:otherClient,client_name:'Allowed only'});
      const bundle = randomUUID(), revision = randomUUID();
      await table('authorization_bundles').insert({tenant,bundle_id:bundle,bundle_key:`att-${bundle.slice(0,8)}`,name:'Other client only',is_system:false,status:'active'});
      await table('authorization_bundle_revisions').insert({tenant,revision_id:revision,bundle_id:bundle,revision_number:1,lifecycle_state:'published'});
      await table('authorization_bundles').where({bundle_id:bundle}).update({published_revision_id:revision});
      for (const action of ['read','update']) {
        await table('authorization_bundle_rules').insert({tenant,bundle_id:bundle,revision_id:revision,resource_type:'ticket',action,template_key:'selected_clients',
          effect:'narrow',config:JSON.stringify({selectedClientIds:[otherClient]}),position:action==='read'?0:1});
      }
      await table('authorization_bundle_assignments').insert({tenant,bundle_id:bundle,target_type:'user',target_id:restricted,status:'active'});
      expect(await canReadCommentAttachment(trx,tenant,restricted,sibling.document)).toBe(false);
      expect(await canAccessAttachmentTicket(trx,tenant,restricted,siblingTicket)).toBe(false);
      expect(await canWriteAttachmentTicket(trx,tenant,restricted,siblingTicket)).toBe(false);
      const internalUser = { ...await table('users').where({user_id:restricted}).first() };
      expect(await getAuthorizedDocumentByFileId(trx,tenant,internalUser,sibling.file)).toBeNull();
      expect(await canReadCommentAttachment(trx,tenant,actor,sibling.document)).toBe(true);
      expect(await canWriteAttachmentTicket(trx,tenant,actor,siblingTicket)).toBe(true);
    });

    it('write gate follows the same record scope; draft rows stay creator-only', async () => {
      // Client write == visibility predicate (the portal comment gate evaluates the same template).
      expect(await canWriteAttachmentTicket(trx,tenant,ownUser,siblingTicket)).toBe(false);
      expect(await canWriteAttachmentTicket(trx,tenant,ownUser,ownTicket)).toBe(true);
      // Reconcile must refuse an actor outside the ticket's record scope.
      const draft = randomUUID(), file = randomUUID(), cid = randomUUID(), thread = randomUUID();
      await table('comment_threads').insert({tenant,thread_id:thread,ticket_id:siblingTicket,root_comment_id:cid,is_internal:false,created_by:actor});
      await table('external_files').insert({tenant,file_id:file,file_name:'d.pdf',original_name:'d.pdf',mime_type:'application/pdf',file_size:1,storage_path:`/test/${file}`,uploaded_by_id:actor});
      await table('documents').insert({tenant,document_id:draft,file_id:file,document_name:'d.pdf',mime_type:'application/pdf',file_size:1,user_id:ownUser,created_by:ownUser,is_client_visible:true});
      await table('ticket_comment_attachments').insert({tenant,document_id:draft,ticket_id:siblingTicket,created_by:ownUser,expires_at:new Date(Date.now()+86400000)});
      await table('comments').insert({tenant,comment_id:cid,thread_id:thread,ticket_id:siblingTicket,user_id:ownUser,author_type:'client',note:note(file),is_internal:false,is_resolution:false});
      await expect(reconcileCommentAttachments(trx,tenant,cid,ownUser)).rejects.toThrow('Attachment ticket access denied');
      // Drafts on an accessible ticket remain visible to the creator only.
      const mine = await upload();
      await table('ticket_comment_attachments').where({document_id:mine.document}).update({created_by:actor});
      expect(await canReadCommentAttachment(trx,tenant,actor,mine.document)).toBe(true);
      const second = await mkUser(null, 'internal');
      expect(await canReadCommentAttachment(trx,tenant,second,mine.document)).toBe(false);
    });
  });

});
