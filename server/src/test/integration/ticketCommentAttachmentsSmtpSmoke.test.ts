import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { config } from 'dotenv';
import { simpleParser } from 'mailparser';

// Opt-in only: a synthetic ticket created through the local UI.
// Never accepts a customer address or remote SMTP server.
describe.runIf(Boolean(process.env.COMMENT_ATTACHMENT_SMOKE_FIXTURE))('comment attachment local SMTP smoke', () => {
  it('sends the persisted UI PDF exactly once and verifies received MIME', async () => {
    config({ path: path.resolve('.env.local'), override: true });
    process.env.DB_PORT = '5472';
    const fixture = JSON.parse(fs.readFileSync(process.env.COMMENT_ATTACHMENT_SMOKE_FIXTURE!, 'utf8'));
    const { getConnection, runWithTenant, tenantDb } = await import('@alga-psa/db');
    const { sendEventEmail } = await import('@/lib/notifications/sendEventEmail');
    await runWithTenant(fixture.tenant, async () => {
      const conn = await getConnection(fixture.tenant);
      const db = tenantDb(conn, fixture.tenant);
      const settings = await db.table('tenant_email_settings').first();
      expect(settings.email_provider).toBe('smtp');
      const smtp = settings.provider_configs.find((p: any) => p.isEnabled);
      expect(['localhost', '127.0.0.1']).toContain(smtp.config.host);
      expect(Number(smtp.config.port)).toBe(3025);
      const ticket = await db.table('tickets').where({ ticket_id: fixture.ticket }).first();
      expect(ticket.title).toBe('Comment attachment email smoke');
      const document = await db.table('documents').where({document_name:'comment-smoke.pdf',created_by:fixture.user}).first();
      const attachment = await db.table('ticket_comment_attachments').where({ticket_id:fixture.ticket,document_id:document.document_id}).first();
      const comment = await db.table('comments').where({ comment_id:attachment.comment_id, ticket_id: fixture.ticket, is_internal: false }).first();
      expect(comment).toBeTruthy();
      const recipient = 'attachment-recipient@example.test';
      const messages = async () => (await (await fetch(`http://127.0.0.1:8080/api/user/${encodeURIComponent(recipient)}/messages`)).json()) as any[];
      const before = await messages();
      const delivered = await db.table('ticket_comment_email_deliveries').where({comment_id:comment.comment_id,recipient,state:'sent'}).first();
      const params = { tenantId: fixture.tenant, to: recipient, subject:'Attachment smoke', template:'ticket-comment-added',
        context:{ ticket:{ id:ticket.ticket_number,title:ticket.title },comment:{content:comment.note,author:'Attachment smoke'} },
        replyContext:{ticketId:fixture.ticket,commentId:comment.comment_id},
      };
      await sendEventEmail(params);
      const received = await messages();
      expect(received.length).toBe(before.length + (delivered ? 0 : 1));
      const parsedMessages = await Promise.all(received.map(m => simpleParser(m.mimeMessage)));
      const parsed = parsedMessages.find(m => m.subject?.includes(ticket.ticket_number) && m.attachments.some(a => a.filename === 'comment-smoke.pdf'))!;
      expect(parsed).toBeTruthy();
      expect(parsed.attachments).toHaveLength(1);
      expect(parsed.attachments[0].filename).toBe('comment-smoke.pdf');
      expect(parsed.attachments[0].content.toString()).toContain('%PDF-1.4');
      expect(parsed.html).toContain('comment-smoke.pdf');
      await sendEventEmail(params);
      expect((await messages()).length).toBe(received.length);
      console.log('Verified SMTP MIME: one PDF with original bytes, filename in body, retry did not duplicate.');
    });
  }, 60000);
  it('routes the isolated UI event through the real subscriber without request tenant context', async () => {
    config({path:path.resolve('.env.local'),override:true}); process.env.DB_PORT='5472';
    const fixture=JSON.parse(fs.readFileSync(process.env.COMMENT_ATTACHMENT_SMOKE_FIXTURE!,'utf8'));
    const {getConnection,tenantDb}=await import('@alga-psa/db');
    const db=tenantDb(await getConnection(fixture.tenant),fixture.tenant);
    const ticket=await db.table('tickets').where({ticket_id:fixture.ticket}).first();
    expect(ticket.title).toBe('Comment attachment email smoke');
    expect(ticket.assigned_to).toBeNull();
    const contact=await db.table('contacts').where({contact_name_id:ticket.contact_name_id}).first();
    expect(contact.email).toBe('attachment-recipient@example.test');
    const document=await db.table('documents').where({document_name:'comment-isolated-event.pdf',created_by:fixture.user}).first();
    const attachment=await db.table('ticket_comment_attachments').where({document_id:document.document_id,ticket_id:fixture.ticket}).first();
    const comment=await db.table('comments').where({comment_id:attachment.comment_id}).first();
    const {ticketEmailSubscriberTestHarness}=await import('@/lib/eventBus/subscribers/ticketEmailSubscriber');
    await ticketEmailSubscriberTestHarness.handleTicketCommentAdded({id:crypto.randomUUID(),eventType:'TICKET_COMMENT_ADDED',payload:{tenantId:fixture.tenant,ticketId:fixture.ticket,actorUserId:fixture.user,comment:{id:comment.comment_id,content:comment.note,author:'Attachment Smoke',isInternal:false}}} as any);
    const messages=await(await fetch('http://127.0.0.1:8080/api/user/attachment-recipient%40example.test/messages')).json();
    const parsed=await Promise.all(messages.map((m:any)=>simpleParser(m.mimeMessage)));
    const received=parsed.find(m=>m.attachments.some(a=>a.filename==='comment-isolated-event.pdf'));
    expect(received).toBeTruthy(); expect(received!.attachments).toHaveLength(1);
    expect(received!.attachments[0].content.toString()).toContain('%PDF-1.4');
  },60000);

});
