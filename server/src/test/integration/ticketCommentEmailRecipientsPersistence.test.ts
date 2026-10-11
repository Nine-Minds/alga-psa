import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { Knex } from 'knex';
import * as dbModule from '@alga-psa/db';
import { TicketModel } from '@shared/models/ticketModel';
import { prepareCommentEmailRecipients } from '@shared/lib/tickets/commentEmailRecipients';
import { TicketService } from '@/lib/api/services/TicketService';
import { createTestDbConnection } from '../../../test-utils/dbConfig';

// The storage half of per-comment Cc/Bcc against a real migrated database:
// who an address resolves to, what lands in comments.metadata, and what the
// API read gives back. Everything runs inside one rolled-back transaction.
describe('per-comment Cc/Bcc storage', () => {
  let conn: Knex;
  let trx: Knex.Transaction;
  let tenant: string, otherTenant: string, agent: string, client: string, ticket: string;
  const table = (name: string) => dbModule.tenantDb(trx, tenant).table(name);

  beforeAll(async () => {
    conn = await createTestDbConnection();
  }, 120_000);
  afterAll(async () => { await conn?.destroy(); });
  afterEach(async () => {
    vi.restoreAllMocks();
    await trx?.rollback();
  });

  beforeEach(async () => {
    trx = await conn.transaction();
    tenant = randomUUID(); otherTenant = randomUUID();
    agent = randomUUID(); client = randomUUID(); ticket = randomUUID();
    for (const id of [tenant, otherTenant]) {
      await trx('tenants').insert({ tenant: id, client_name: 'Cc/Bcc storage', email: 'tenant@example.test', product_code: 'psa' });
    }
    await table('clients').insert({ tenant, client_id: client, client_name: 'Cc/Bcc fixture' });
    await table('users').insert({ tenant, user_id: agent, username: agent, email: 'tech@msp.test', hashed_password: 'unused', user_type: 'internal', is_inactive: false, first_name: 'Tech', last_name: 'Agent' });
    await table('tickets').insert({ tenant, ticket_id: ticket, ticket_number: `STORE-${ticket.slice(0, 8)}`, client_id: client, title: 'Cc/Bcc storage', entered_by: agent });
    vi.spyOn(dbModule, 'getConnection').mockResolvedValue(trx);
    vi.spyOn(dbModule, 'createTenantKnex').mockResolvedValue({ knex: trx, tenant } as any);
  });

  it('T007: addresses resolve to the tenant\'s contacts and internal users, and nobody else\'s', async () => {
    const primaryContact = randomUUID(), additionalContact = randomUUID();
    await table('contacts').insert([
      { tenant, contact_name_id: primaryContact, client_id: client, full_name: 'Jane Doe', email: 'jane@client.test' },
      { tenant, contact_name_id: additionalContact, client_id: client, full_name: 'Sam Second', email: 'sam@client.test' },
    ]);
    await table('contact_additional_email_addresses').insert({
      tenant, contact_name_id: additionalContact, email_address: 'Sam.Work@client.test',
      canonical_type: 'work',
    });
    // Same address, different tenant: must never match.
    const foreignClient = randomUUID();
    await dbModule.tenantDb(trx, otherTenant).table('clients').insert({ tenant: otherTenant, client_id: foreignClient, client_name: 'Other tenant' });
    await dbModule.tenantDb(trx, otherTenant).table('contacts').insert({
      tenant: otherTenant, contact_name_id: randomUUID(), client_id: foreignClient,
      full_name: 'Not Ours', email: 'stranger@elsewhere.test',
    });

    const resolved = await prepareCommentEmailRecipients(trx, tenant, {
      cc: ['Jane@client.test', 'sam.work@CLIENT.test'],
      bcc: ['tech@msp.test', 'stranger@elsewhere.test'],
    });

    expect(resolved?.cc).toEqual([
      // The typed casing is kept; the identity comes from the contact row.
      { email: 'Jane@client.test', name: 'Jane Doe', contact_id: primaryContact },
      { email: 'sam.work@CLIENT.test', name: 'Sam Second', contact_id: additionalContact },
    ]);
    expect(resolved?.bcc).toEqual([
      { email: 'tech@msp.test', name: 'Tech Agent', user_id: agent },
      // Another tenant's contact stays an anonymous address.
      { email: 'stranger@elsewhere.test' },
    ]);
  }, 60_000);

  it('T008: createComment stores email_recipients beside the metadata it already had', async () => {
    const created = await TicketModel.createComment(
      {
        ticket_id: ticket,
        content: 'Looping in the vendor',
        is_internal: false,
        is_resolution: false,
        author_type: 'internal',
        author_id: agent,
        metadata: { closes_ticket: true, source: 'test' },
        emailRecipients: { cc: ['vendor@acme.test'], bcc: ['boss@msp.test'] },
      } as never,
      tenant,
      trx,
      undefined,
      undefined,
      agent,
    );

    const row = await table('comments').where({ comment_id: created.comment_id }).first();
    const metadata = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    expect(metadata.closes_ticket).toBe(true);
    expect(metadata.source).toBe('test');
    expect(metadata.email_recipients).toEqual({
      cc: [{ email: 'vendor@acme.test' }],
      bcc: [{ email: 'boss@msp.test' }],
    });
  }, 60_000);

  it('T019: reading the ticket\'s comments returns email_recipients, and none when there are none', async () => {
    const withRecipients = await TicketModel.createComment(
      {
        ticket_id: ticket, content: 'Copied reply', is_internal: false, is_resolution: false,
        author_type: 'internal', author_id: agent,
        emailRecipients: { cc: ['vendor@acme.test'], bcc: ['boss@msp.test'] },
      } as never,
      tenant, trx, undefined, undefined, agent,
    );
    const plain = await TicketModel.createComment(
      {
        ticket_id: ticket, content: 'Plain reply', is_internal: false, is_resolution: false,
        author_type: 'internal', author_id: agent,
      } as never,
      tenant, trx, undefined, undefined, agent,
    );

    const service = new TicketService();
    vi.spyOn(service as never as { getKnex: () => Promise<{ knex: Knex }> }, 'getKnex')
      .mockResolvedValue({ knex: trx } as never);
    const comments = await service.getTicketComments(ticket, { tenant, userId: agent } as never);

    const byId = new Map(comments.map((comment: any) => [comment.comment_id, comment]));
    expect(byId.get(withRecipients.comment_id).email_recipients).toEqual({
      cc: [{ email: 'vendor@acme.test' }],
      bcc: [{ email: 'boss@msp.test' }],
    });
    expect(byId.get(plain.comment_id).email_recipients).toBeNull();
  }, 60_000);

  it('T013: a bundled child copy of a copied comment carries no recipients', async () => {
    const master = await TicketModel.createComment(
      {
        ticket_id: ticket, content: 'Copied reply', is_internal: false, is_resolution: false,
        author_type: 'internal', author_id: agent,
        emailRecipients: { cc: ['vendor@acme.test'], bcc: ['boss@msp.test'] },
      } as never,
      tenant, trx, undefined, undefined, agent,
    );
    const child = randomUUID();
    await table('tickets').insert({
      tenant, ticket_id: child, ticket_number: `CHILD-${child.slice(0, 8)}`, client_id: client,
      title: 'Bundled child', entered_by: agent, master_ticket_id: ticket,
    });
    const source = await table('comments').where({ comment_id: master.comment_id }).first();

    const { mirrorCommentToChild } = await import('@alga-psa/tickets/actions/ticketBundleUtils');
    const childCommentId = await mirrorCommentToChild(trx, tenant, {
      sourceComment: {
        comment_id: source.comment_id,
        note: source.note,
        markdown_content: source.markdown_content,
        user_id: source.user_id,
        contact_id: source.contact_id,
        author_type: source.author_type,
      },
      childTicketId: child,
      isResolution: false,
    });

    const mirrored = await table('comments').where({ comment_id: childCommentId }).first();
    const metadata = typeof mirrored.metadata === 'string' ? JSON.parse(mirrored.metadata) : mirrored.metadata;
    // The copy belongs to the child's own requester; the one-off recipients
    // chosen on the master must not be mailed a second time.
    expect(metadata?.email_recipients).toBeUndefined();
  }, 60_000);

  it('T019: a client-visible read keeps the Cc and never the Bcc', async () => {
    const comment = await TicketModel.createComment(
      {
        ticket_id: ticket, content: 'Copied reply', is_internal: false, is_resolution: false,
        author_type: 'internal', author_id: agent,
        emailRecipients: { cc: ['vendor@acme.test'], bcc: ['boss@msp.test'] },
      } as never,
      tenant, trx, undefined, undefined, agent,
    );

    const service = new TicketService();
    vi.spyOn(service as never as { getKnex: () => Promise<{ knex: Knex }> }, 'getKnex')
      .mockResolvedValue({ knex: trx } as never);
    // A client-portal caller reaches the same service; the mask has to live
    // here so no caller of it can serve a blind copy to a contact.
    vi.spyOn(service as never as { resolveClientTicketVisibility: () => Promise<unknown> }, 'resolveClientTicketVisibility')
      .mockResolvedValue({ contactId: 'contact-1', clientId: client } as never);

    const [visible] = await service.getTicketComments(ticket, { tenant, userId: agent } as never);

    expect(visible.comment_id).toBe(comment.comment_id);
    expect(visible.email_recipients).toEqual({ cc: [{ email: 'vendor@acme.test' }], bcc: [] });
    // The raw row is spread into the response, so the metadata must be masked too.
    expect(visible.metadata.email_recipients.bcc).toEqual([]);
  }, 60_000);
});
