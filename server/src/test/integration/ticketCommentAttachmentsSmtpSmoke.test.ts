import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import { simpleParser } from 'mailparser';
import * as dbModule from '@alga-psa/db';
import { StorageService } from '@alga-psa/storage/StorageService';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { reconcileCommentAttachments } from '@shared/lib/ticketCommentAttachments';

// Real migrated DB, email service/provider and SMTP. Only storage bytes and
// connection routing are supplied by the fixture; no sender/subscriber mocks.
describe('comment attachment delivery over isolated SMTP', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, actor: string, ticket: string, comment: string, recipient: string;
  let smtpPort: number, apiPort: number;
  const pdf = Buffer.from('%PDF-1.4\nSynthetic comment attachment\n%%EOF');
  const table = (name: string) => dbModule.tenantDb(trx, tenant).table(name);

  beforeAll(async () => {
    if (process.env.COMMENT_SMTP_ISOLATED !== 'true') throw new Error('COMMENT_SMTP_ISOLATED=true is required');
    smtpPort = Number(process.env.COMMENT_SMTP_PORT);
    apiPort = Number(process.env.COMMENT_SMTP_API_PORT);
    for (const port of [smtpPort, apiPort]) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Explicit isolated SMTP and API ports are required');
    }
    conn = await createTestDbConnection();
  }, 120_000);
  afterAll(async () => { await conn?.destroy(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await trx?.rollback();
  });

  beforeEach(async () => {
    trx = await conn.transaction();
    tenant = randomUUID(); actor = randomUUID(); ticket = randomUUID(); comment = randomUUID();
    recipient = `attachment-${randomUUID()}@example.test`;
    const client = randomUUID(), contact = randomUUID(), thread = randomUUID();
    await trx('tenants').insert({ tenant, client_name: 'Isolated SMTP attachments', email: 'tenant@example.test', product_code: 'psa' });
    await table('clients').insert({ tenant, client_id: client, client_name: 'SMTP fixture' });
    await table('contacts').insert({ tenant, contact_name_id: contact, client_id: client, full_name: 'Recipient', email: recipient });
    await table('users').insert({ tenant, user_id: actor, username: actor, email: 'agent@example.test', hashed_password: 'unused', user_type: 'internal', is_inactive: false });
    await table('tickets').insert({ tenant, ticket_id: ticket, ticket_number: 'SMTP-1', client_id: client, contact_name_id: contact, title: 'Comment attachment SMTP smoke', entered_by: actor });
    await table('comment_threads').insert({ tenant, thread_id: thread, ticket_id: ticket, root_comment_id: comment, is_internal: false, created_by: actor });
    await table('comments').insert({ tenant, comment_id: comment, thread_id: thread, ticket_id: ticket, user_id: actor, author_type: 'internal', note: '[]', is_internal: false, is_resolution: false });
    let publishedFile = '';
    for (const name of ['comment-smoke.pdf', 'unrelated-draft.pdf']) {
      const document = randomUUID(), file = randomUUID();
      await table('external_files').insert({ tenant, file_id: file, file_name: name, original_name: name, mime_type: 'application/pdf', file_size: pdf.length, storage_path: `/test/${file}`, uploaded_by_id: actor });
      await table('documents').insert({ tenant, document_id: document, file_id: file, document_name: name, mime_type: 'application/pdf', file_size: pdf.length, user_id: actor, created_by: actor, is_client_visible: true });
      await table('document_associations').insert({ tenant, document_id: document, entity_type: 'ticket', entity_id: ticket });
      await table('ticket_comment_attachments').insert({ tenant, document_id: document, ticket_id: ticket, created_by: actor, expires_at: new Date(Date.now() + 86400000) });
      if (name === 'comment-smoke.pdf') publishedFile = file;
    }
    const content = JSON.stringify([{ type: 'file', props: { url: `/api/documents/download/${publishedFile}`, name: 'comment-smoke.pdf' } }]);
    await table('comments').where({ comment_id: comment }).update({ note: content });
    await reconcileCommentAttachments(trx, tenant, comment, actor);
    await table('tenant_email_templates').insert({ tenant, name: 'ticket-comment-added', language_code: 'en', subject: 'Attachment smoke', html_content: '{{{comment.content}}}', text_content: '{{comment.text}}' });
    await table('tenant_email_settings').insert({ tenant, email_provider: 'smtp', default_from_domain: 'example.test', ticketing_from_email: 'agent@example.test', provider_configs: JSON.stringify([{
      providerId: `smtp-${tenant}`, providerType: 'smtp', isEnabled: true,
      config: { host: '127.0.0.1', port: smtpPort, secure: false, rejectUnauthorized: false, from: 'agent@example.test' },
    }]) });
    vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
    vi.spyOn(StorageService, 'downloadFile').mockResolvedValue({ buffer: pdf } as any);
    const { getSecretProviderInstance } = await import('@alga-psa/core/secrets');
    vi.spyOn(await getSecretProviderInstance(), 'getAppSecret').mockImplementation(async name =>
      name.toLowerCase() === 'nextauth_secret' ? 'isolated-smtp-test-secret' : undefined);
    vi.stubEnv('NEXTAUTH_URL', 'http://localhost:3000');
  });

  async function messages(): Promise<any[]> {
    const response = await fetch(`http://127.0.0.1:${apiPort}/api/user/${encodeURIComponent(recipient)}/messages`);
    if (response.status === 400) {
      expect(await response.json()).toEqual({ message: `User '${recipient}' not found` });
      return [];
    }
    expect(response.status).toBe(200);
    return response.json();
  }

  it.each(['direct', 'subscriber'] as const)('delivers exact PDF bytes once via %s and preserves retry deduplication', async mode => {
    const row = await table('comments').where({ comment_id: comment }).first();
    const { sendEventEmail } = await import('@/lib/notifications/sendEventEmail');
    const { ticketEmailSubscriberTestHarness } = await import('@/lib/eventBus/subscribers/ticketEmailSubscriber');
    const event = { id: randomUUID(), eventType: 'TICKET_COMMENT_ADDED', payload: { tenantId: tenant, ticketId: ticket, actorUserId: actor,
      comment: { id: comment, content: row.note, author: 'Agent', isInternal: false } } } as any;
    const send = mode === 'direct'
      ? () => dbModule.runWithTenant(tenant, () => sendEventEmail({ tenantId: tenant, to: recipient, subject: 'Attachment smoke', template: 'ticket-comment-added', locale: 'en',
        context: { ticket: { id: 'SMTP-1', title: 'Comment attachment SMTP smoke' }, comment: { content: row.note, author: 'Agent' } },
        replyContext: { ticketId: ticket, commentId: comment } }))
      : () => ticketEmailSubscriberTestHarness.handleTicketCommentAdded(event);
    expect(await messages()).toHaveLength(0);
    expect(dbModule.getTenantContext()).toBeUndefined();
    await send();
    const received = await messages();
    expect(received).toHaveLength(1);
    const parsed = await simpleParser(received[0].mimeMessage);
    expect(parsed.subject).toContain('SMTP-1');
    expect(parsed.attachments).toHaveLength(1);
    expect(parsed.attachments[0].filename).toBe('comment-smoke.pdf');
    expect(parsed.attachments[0].content).toEqual(pdf);
    expect(parsed.html).toContain('comment-smoke.pdf');
    expect(await table('ticket_comment_email_deliveries').where({ comment_id: comment, recipient, state: 'sent' })).toHaveLength(1);
    await send();
    expect(await messages()).toHaveLength(1);
  }, 60_000);
});
