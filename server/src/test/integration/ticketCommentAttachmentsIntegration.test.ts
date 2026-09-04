import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { tenantDb, getTenantContext } from '@alga-psa/db';
import * as dbModule from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { NextRequest } from 'next/server';

const routeSession = vi.hoisted(() => ({ user: null as any, permitted: true }));
vi.mock('@alga-psa/user-composition/actions', () => ({ getCurrentUser: async () => routeSession.user }));
vi.mock('@/lib/auth/rbac', () => ({ hasPermission: async () => routeSession.permitted }));
import { createTestDbConnection, wireLocalTestDbEnv } from '../../../test-utils/dbConfig';
import {
  canReadCommentAttachment, reconcileCommentAttachments, expireCommentAttachmentDrafts,
  listPublishedCommentAttachments, filterReadableCommentAttachments,
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
    expect(publish).toHaveBeenCalledTimes(2); // Edits never resend existing files.
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
      expect((await GET(request())).status).toBe(401);
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
    await vi.waitFor(() => expect(publisher.publishCommentCreated).toHaveBeenCalledTimes(1));
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

});
