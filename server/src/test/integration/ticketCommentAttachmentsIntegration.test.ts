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
}));
vi.mock('@alga-psa/auth/rbac', () => ({
  hasPermission: async (_user: unknown, resource: string) => routeSession.permitted && (resource !== 'document' || routeSession.documentsPermitted),
}));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => routeSession.permitted }));
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import {
  canReadCommentAttachment, reconcileCommentAttachments, expireCommentAttachmentDrafts,
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

// Run against an already migrated isolated database. Never bootstrap/drop the dev stack.
const enabled = Boolean(process.env.TEST_DB_NAME);
describe.runIf(enabled)('ticket comment attachments (migrated PostgreSQL)', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, actor: string, clientUser: string, otherUser: string, client: string, ticket: string, comment: string;
  const table = (name: string) => tenantDb(trx, tenant).table(name);
  const recipient = 'attachment-recipient@example.test';
  beforeAll(async () => {
    wireLocalTestDbEnv();
    conn = await createTestDbConnection({ databaseName: process.env.TEST_DB_NAME, recreate: false });
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
    const additionalDrafts = [];
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
    const secret = vi.spyOn(await getSecretProviderInstance(), 'getAppSecret').mockResolvedValue('bundle-test-secret');
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
      const pending = { tenantId: tenant, to: childEmail, subject: 'Pending bundle update', template: 'ticket-comment-added', locale: 'en' as const,
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
    const params={tenantId:tenant,to:recipient,subject:'Recovery',template:'ticket-comment-added',context:{ticket:{id:'ATT-1'},comment:{content:'ignored'}},replyContext:{ticketId:ticket,commentId:comment}};
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

  it.runIf(process.env.COMMENT_RECOVERY_LIVE_SMOKE === '1')('live PgBoss discovery reuses workers and recovers a committed publication to SMTP once', async () => {
    const { default: PgBoss } = await import('pg-boss');
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
      await table('contacts').where({ client_id: client }).update({ email: mailbox });
      await table('users').where({ user_id: clientUser }).update({ email: mailbox });
      const pdf = await upload(filename, 'application/pdf', bytes.length); await attach(pdf.file);
      await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Worker recovery', html_content: '{{{comment.content}}}', text_content: '{{comment.text}}' });
      await persistCommentPublication(trx, { payload: { tenantId: tenant, ticketId: ticket, commentId: comment, userId: actor } });
      await trx.commit(); committed = true;
      spy(vi.spyOn(dbModule, 'getConnection').mockResolvedValue(conn));
      spy(vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: conn, tenant } as any));
      spy(vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: bytes } as any));
      await provider.initialize({ host: '127.0.0.1', port: 3025, secure: false, from: 'agent@example.test' });
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
      const publish = vi.spyOn(publishers, 'publishEvent')
        .mockRejectedValueOnce(new Error('Recoverable publication transport outage'))
        .mockImplementation(async () => sendEventEmail({ tenantId: tenant, to: mailbox, subject: 'Worker recovery', template: 'ticket-comment-added', context: { comment: { content: 'Recovery smoke' } }, replyContext: { ticketId: ticket, commentId: comment } }));
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
      const messages = await (await fetch(`http://127.0.0.1:8080/api/user/${encodeURIComponent(mailbox)}/messages`)).json();
      expect(messages).toHaveLength(1);
      const mime = await simpleParser(messages[0].mimeMessage);
      expect(mime.attachments).toHaveLength(1); expect(mime.attachments[0].filename).toBe(filename);
      expect(mime.attachments[0].content.equals(bytes)).toBe(true);
      expect(errors).toEqual([]);
      console.log(`Live PgBoss: ${registrations.mock.calls.length} handlers registered once over three ticks; failed committed publication recovered with one SMTP PDF delivery.`);
    } finally {
      await boss.stop({ graceful: true });
      (provider as any).transporter?.close();
      for (const restore of restores.reverse()) restore();
      await conn.raw('DROP SCHEMA IF EXISTS ?? CASCADE', [schema]);
      if (committed) {
        for (const name of ['email_reply_tokens', 'email_sending_logs', 'ticket_comment_email_deliveries', 'tenant_email_templates', 'ticket_comment_attachments', 'comments', 'comment_threads', 'document_associations', 'documents', 'external_files', 'tickets', 'users', 'contacts', 'clients']) {
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
    const publish=vi.spyOn(publishers,'publishEvent').mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(undefined);
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

});
