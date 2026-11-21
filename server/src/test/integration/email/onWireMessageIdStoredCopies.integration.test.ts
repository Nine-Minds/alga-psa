import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import type { Knex } from 'knex';
import { resetTenantConnectionPool } from '@alga-psa/db';
import { applyTicketThreadHeaders } from '@alga-psa/email/BaseEmailService';
import { normalizedMessageIdSql, reconcileOnWireMessageId } from '@alga-psa/email/reconcileOnWireMessageId';
import { normalizeRfc822MessageId } from '@alga-psa/shared/services/email/inboundEmailIdentity';
import { createTestDbConnection } from '../../../../test-utils/dbConfig';
import { createClient, createTenant } from '../../../../test-utils/testDataFactory';

/**
 * The Resend webhook records the on-wire Message-ID and rewrites every stored copy of the id we generated
 * (comment_threads.email_message_id / email_references, tickets.email_metadata.references / threadRoot).
 * The rewrite is a set-based UPDATE (the webhook route reads no ticket or thread rows), so the element
 * matching runs in SQL and must agree with normalizeRfc822MessageId exactly.
 */

const GEN = '<gen-1@perceptiveit.net>';
const GEN_OTHER = '<gen-0@perceptiveit.net>';
const WIRE = '<0100019abc-def-000000@email.amazonses.com>';
const CUSTOMER = '<customer@x.com>';

describe('on-wire Message-ID: stored copies (alga0002306)', () => {
  let knex: Knex;

  beforeAll(async () => {
    knex = await createTestDbConnection();
    await resetTenantConnectionPool();
  });

  afterAll(async () => {
    await knex?.destroy();
    await resetTenantConnectionPool();
  });

  it('normalizes Message-IDs in SQL exactly as normalizeRfc822MessageId does', async () => {
    const corpus = [
      '<abc@Example.COM>',
      'abc@Example.COM',
      '  <  abc@EXAMPLE.com  >  ',
      'rfc822:abc@EXAMPLE.com',
      '<rfc822:rfc822: Abc@Example.Com>',
      'Local.Part@Mixed.Case',
      'a@b@C.D',
      '@Example.COM',
      'no-at-sign',
      '<>',
      '< >',
      '',
      '   ',
      'rfc822:',
      '<x@y>trailing',
      '\t<tab@Example.com>\n',
    ];
    for (const input of corpus) {
      const { rows } = await knex.raw(`SELECT ${normalizedMessageIdSql('x.v')} AS n FROM (SELECT ?::text AS v) x`, [input]);
      expect(rows[0].n, JSON.stringify(input)).toBe(normalizeRfc822MessageId(input));
    }
  });

  async function seedTenant() {
    const tenant = await createTenant(knex, `On-wire ${uuidv4().slice(0, 8)}`);
    const clientId = await createClient(knex, tenant, 'On-wire client');
    const ticketId = uuidv4();
    const untouchedTicketId = uuidv4();
    const threadId = uuidv4();
    const ticket = (id: string, emailMetadata: Record<string, unknown>) => ({
      tenant,
      ticket_id: id,
      ticket_number: `OW-${uuidv4().slice(0, 8)}`,
      title: 'On-wire',
      client_id: clientId,
      entered_at: knex.fn.now(),
      updated_at: '2020-01-01T00:00:00Z',
      email_metadata: JSON.stringify(emailMetadata),
    });
    await knex('tickets').insert([
      ticket(ticketId, {
        messageId: CUSTOMER,
        // domain-case and bracket variants are the same id; WIRE already present later is de-duplicated
        threadRoot: 'gen-1@PERCEPTIVEIT.NET',
        references: [CUSTOMER, GEN_OTHER, '<gen-1@PerceptiveIT.net>', 42, WIRE, '<later@x.com>'],
        threadId: 'provider-thread',
      }),
      ticket(untouchedTicketId, { messageId: CUSTOMER, references: [CUSTOMER, GEN_OTHER] }),
    ]);
    await knex('comment_threads').insert({
      tenant,
      thread_id: threadId,
      ticket_id: ticketId,
      root_comment_id: uuidv4(),
      email_message_id: GEN,
      email_references: knex.raw('?::text[]', [[GEN_OTHER, 'rfc822:gen-1@perceptiveit.net', '<tail@x.com>']]),
    });
    await knex('email_sending_logs').insert({
      tenant,
      provider_id: 'resend-test',
      provider_type: 'resend',
      provider_message_id: 're_shared_id',
      rfc_message_id: GEN,
      from_address: 'support@perceptiveit.net',
      to_addresses: JSON.stringify(['customer@x.com']),
      status: 'sent',
      sent_at: knex.fn.now(),
      entity_type: 'ticket',
      entity_id: ticketId,
      comment_thread_id: threadId,
      metadata: JSON.stringify({ algaDiagnostics: { outbound: { rfcMessageId: GEN, ticketId } } }),
    });
    return { tenant, ticketId, untouchedTicketId, threadId };
  }

  const xminOf = async (tenant: string, ticketId: string) =>
    (await knex('tickets').where({ tenant, ticket_id: ticketId }).first(knex.raw('xmin::text AS xmin'))).xmin;

  it('rewrites each stored copy by element in one tenant only, and builds thread headers from on-wire ids', async () => {
    const a = await seedTenant();
    const b = await seedTenant();
    const untouchedXmin = await xminOf(a.tenant, a.untouchedTicketId);
    const otherTenantBefore = await knex('tickets').where({ tenant: b.tenant, ticket_id: b.ticketId }).first('email_metadata', 'updated_at');

    const result = await reconcileOnWireMessageId(knex, { tenant: a.tenant, providerMessageId: 're_shared_id', onWireMessageId: WIRE });
    expect(result).toMatchObject({ status: 'recorded', rowsMatched: 1, rowsRecorded: 1 });

    const log = await knex('email_sending_logs').where({ tenant: a.tenant, provider_message_id: 're_shared_id' }).first();
    expect(log.rfc_message_id).toBe(WIRE);
    expect(log.metadata.generatedRfcMessageId).toBe(GEN);

    const thread = await knex('comment_threads').where({ tenant: a.tenant, thread_id: a.threadId }).first();
    expect(thread.email_message_id).toBe(WIRE);
    expect(thread.email_references).toEqual([GEN_OTHER, WIRE, '<tail@x.com>']);

    const ticket = await knex('tickets').where({ tenant: a.tenant, ticket_id: a.ticketId }).first('email_metadata', 'updated_at');
    expect(ticket.email_metadata).toEqual({
      messageId: CUSTOMER,
      threadRoot: WIRE,
      references: [CUSTOMER, GEN_OTHER, WIRE, '<later@x.com>'],
      threadId: 'provider-thread',
    });
    // email_metadata is bookkeeping: no updated_at bump.
    expect(new Date(ticket.updated_at).toISOString()).toBe('2020-01-01T00:00:00.000Z');
    // A ticket that holds no copy of the generated id is not written at all.
    expect(await xminOf(a.tenant, a.untouchedTicketId)).toBe(untouchedXmin);
    // Same provider_message_id in another tenant: untouched.
    expect(await knex('tickets').where({ tenant: b.tenant, ticket_id: b.ticketId }).first('email_metadata', 'updated_at')).toEqual(otherTenantBefore);
    expect((await knex('comment_threads').where({ tenant: b.tenant, thread_id: b.threadId }).first()).email_message_id).toBe(GEN);

    // Idempotent: a redelivered webhook changes nothing.
    const ticketXmin = await xminOf(a.tenant, a.ticketId);
    expect((await reconcileOnWireMessageId(knex, { tenant: a.tenant, providerMessageId: 're_shared_id', onWireMessageId: WIRE })).status).toBe('unchanged');
    expect(await xminOf(a.tenant, a.ticketId)).toBe(ticketXmin);

    const headers: Record<string, string> = {};
    await applyTicketThreadHeaders({ tenantId: a.tenant, ticketId: a.ticketId, headers, serviceName: 'Test' });
    expect(headers.References.split(' ')).not.toContain(GEN);
    expect(headers.References).not.toMatch(/gen-1@/i);
  });
});
