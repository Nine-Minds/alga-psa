import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';
import { tenantDb } from '@alga-psa/db';
import { createContactForInboundSender } from '../../../../shared/workflow/actions/emailWorkflowActions';
import { InboundEmailOutboxEventPublisher } from '../../../../shared/workflow/adapters/inboundEmailOutboxEventPublisher';

vi.mock('@alga-psa/event-bus/publishers', () => ({ publishWorkflowEvent: vi.fn() }));

const describeDb = await describeWithDb();
let db: Knex;
let tenantId: string;
let clientId: string;

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => db),
  destroyAdminConnection: vi.fn(async () => {}),
}));

describeDb('inbound email auto-created contact helper (integration)', () => {
  beforeAll(async () => {
    db = await createTestDbConnection();
    const discovery = tenantDb(db, '__test_discovery__');
    const tenant = await discovery.unscoped('tenants', 'discover tenant for inbound contact helper test').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;
    const client = await tenantDb(db, tenantId).table('clients').where({ is_inactive: false }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected active seeded client');
    clientId = client.client_id;
  }, 180_000);

  afterAll(async () => { if (db) await db.destroy(); });

  it('creates once for repeated addresses and rolls the contact back with the supplied transaction', async () => {
    const email = `inbound-${crypto.randomUUID()}@example.invalid`;
    let contactId = '';
    const inboxId = crypto.randomUUID();
    try {
      await db.transaction(async (trx) => {
        await tenantDb(trx, tenantId).table('inbound_email_inbox').insert({ tenant: tenantId, inbox_id: inboxId, provider_id: crypto.randomUUID(), provider_type: 'google', normalized_message_id: `<${inboxId}@example.invalid>`, envelope: JSON.stringify({}), legacy_imported: true, status: 'skipped', outcome_kind: 'skipped', outcome_reason: 'test', completed_at: db.fn.now(), created_at: db.fn.now(), updated_at: db.fn.now() });
        const publisher = new InboundEmailOutboxEventPublisher({ trx, tenantId, inboxId });
        const result = await createContactForInboundSender(
          { email, name: 'Inbound Test Sender', clientId }, tenantId,
          { existingConnection: trx, inboxId: crypto.randomUUID(), contactEventPublisher: publisher }
        );
        expect(result).toMatchObject({ created: true });
        contactId = result!.contactId;
        const row = await tenantDb(trx, tenantId).table('contacts').where({ contact_name_id: contactId }).first();
        expect(row).toMatchObject({ full_name: 'Inbound Test Sender', email, client_id: clientId });
        const outbox = await tenantDb(trx, tenantId).table('inbound_email_outbox').where({ inbox_id: inboxId, event_type: 'CONTACT_CREATED' }).first();
        expect(outbox).toMatchObject({ event_type: 'CONTACT_CREATED' });
        expect(outbox.payload).toMatchObject({ contactId, clientId, email });
        await expect(createContactForInboundSender(
          { email, name: 'Inbound Test Sender', clientId }, tenantId,
          { existingConnection: trx, inboxId: crypto.randomUUID(), contactEventPublisher: publisher }
        )).resolves.toEqual({ contactId, created: false });
        expect(await tenantDb(trx, tenantId).table('inbound_email_outbox').where({ inbox_id: inboxId, event_type: 'CONTACT_CREATED' })).toHaveLength(1);
        throw new Error('rollback-test');
      });
    } catch (error) {
      expect((error as Error).message).toBe('rollback-test');
    }
    const rowAfterRollback = await tenantDb(db, tenantId).table('contacts').where({ contact_name_id: contactId }).first();
    expect(rowAfterRollback).toBeUndefined();
    expect(await tenantDb(db, tenantId).table('inbound_email_outbox').where({ inbox_id: inboxId, event_type: 'CONTACT_CREATED' })).toHaveLength(0);
  }, 60_000);

  it('serializes concurrent creation and only returns the same-client contact to both callers', async () => {
    const email = `inbound-race-${crypto.randomUUID()}@example.invalid`;
    const results = await Promise.all([
      createContactForInboundSender({ email, name: 'Concurrent Sender', clientId }, tenantId),
      createContactForInboundSender({ email, name: 'Concurrent Sender', clientId }, tenantId),
    ]);
    expect(results.filter((result) => result?.created)).toHaveLength(1);
    expect(results[0]?.contactId).toBe(results[1]?.contactId);
    expect(await tenantDb(db, tenantId).table('contacts').where({ email, client_id: clientId })).toHaveLength(1);
    await tenantDb(db, tenantId).table('contacts').where({ email }).delete();
  }, 60_000);

  it('does not create an address known as another client contact or internal user, or for an inactive client', async () => {
    const scopedDb = tenantDb(db, tenantId);
    const otherClientId = (await scopedDb.table('clients').whereNot({ client_id: clientId }).first<{ client_id: string }>('client_id'))?.client_id;
    if (!otherClientId) throw new Error('Expected another seeded client');
    const otherEmail = `additional-${crypto.randomUUID()}@example.invalid`;
    const otherContactId = crypto.randomUUID();
    await scopedDb.table('contacts').insert({ tenant: tenantId, contact_name_id: otherContactId, full_name: 'Other Client', email: `other-${crypto.randomUUID()}@example.invalid`, client_id: otherClientId, is_inactive: false, created_at: db.fn.now(), updated_at: db.fn.now() });
    await scopedDb.table('contact_additional_email_addresses').insert({ tenant: tenantId, contact_name_id: otherContactId, email_address: otherEmail, canonical_type: 'work' });
    expect(await createContactForInboundSender({ email: otherEmail, clientId }, tenantId)).toBeNull();

    const internalEmail = `internal-${crypto.randomUUID()}@example.invalid`;
    const userId = crypto.randomUUID();
    await scopedDb.table('users').insert({ tenant: tenantId, user_id: userId, username: userId, email: internalEmail, hashed_password: 'unused', user_type: 'internal', is_inactive: false });
    expect(await createContactForInboundSender({ email: internalEmail, clientId }, tenantId)).toBeNull();

    const inactiveClientId = crypto.randomUUID();
    await scopedDb.table('clients').insert({ tenant: tenantId, client_id: inactiveClientId, client_name: `Inactive ${inactiveClientId.slice(0, 6)}`, is_inactive: true, created_at: db.fn.now(), updated_at: db.fn.now() });
    expect(await createContactForInboundSender({ email: `inactive-${crypto.randomUUID()}@example.invalid`, clientId: inactiveClientId }, tenantId)).toBeNull();

    await scopedDb.table('users').where({ user_id: userId }).delete();
    await scopedDb.table('contact_additional_email_addresses').where({ contact_name_id: otherContactId }).delete();
    await scopedDb.table('contacts').where({ contact_name_id: otherContactId }).delete();
    await scopedDb.table('clients').where({ client_id: inactiveClientId }).delete();
  }, 60_000);

  it('processes parallel new-ticket emails into two tickets attributed to one created contact', async () => {
    const { processInboundEmailInApp } = await import('../../../../shared/services/email/processInboundEmailInApp');
    const scopedDb = tenantDb(db, tenantId);
    const defaults = await scopedDb.table('inbound_ticket_defaults').where({ is_active: true }).first<any>();
    if (!defaults) throw new Error('Expected active inbound ticket defaults');
    const providerId = crypto.randomUUID();
    const domainId = crypto.randomUUID();
    const domain = `race-${crypto.randomUUID().slice(0, 8)}.example.invalid`;
    const mailbox = `support-${crypto.randomUUID().slice(0, 8)}@example.invalid`;
    const sender = `new-sender-${crypto.randomUUID().slice(0, 8)}@${domain}`;
    await scopedDb.table('email_providers').insert({ tenant: tenantId, id: providerId, provider_type: 'google', provider_name: 'Auto-create integration', mailbox, is_active: true, status: 'connected', inbound_ticket_defaults_id: defaults.id, created_at: db.fn.now(), updated_at: db.fn.now() });
    await scopedDb.table('client_inbound_email_domains').insert({ tenant: tenantId, id: domainId, client_id: defaults.client_id, domain, auto_create_contacts: true, created_at: db.fn.now(), updated_at: db.fn.now() });

    const buildEmail = (id: string, senderAddress = sender, authenticationResults = `mx.example; spf=pass smtp.mailfrom=${domain}; dmarc=pass header.from=${domain}`) => ({
      id, provider: 'google', providerId, tenant: tenantId, receivedAt: new Date().toISOString(),
      from: { email: `"Race Sender" <${senderAddress}>`, name: 'Race Sender' }, to: [{ email: mailbox, name: 'Support' }],
      subject: `Parallel inbound ${id}`, body: { text: 'Hello', html: undefined }, attachments: [],
      headers: { 'authentication-results': authenticationResults },
    } as any);

    const emailIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    let internalSender: string | null = null;
    try {
      const results = await Promise.all(emailIds.slice(0, 2).map((id) => processInboundEmailInApp({ tenantId, providerId, emailData: buildEmail(id) })));
      expect(results.map((result) => result.outcome)).toEqual(['created', 'created']);
      const contact = await scopedDb.table('contacts').where({ email: sender, client_id: defaults.client_id }).first<any>();
      expect(contact).toMatchObject({ full_name: 'Race Sender', primary_email_canonical_type: 'work' });
      const tickets = await scopedDb.table('tickets').whereIn('title', emailIds.map((id) => `Parallel inbound ${id}`));
      expect(tickets).toHaveLength(2);
      expect(tickets.every((ticket: any) => ticket.contact_name_id === contact.contact_name_id)).toBe(true);
      const repeatId = emailIds[2];
      const repeat = await processInboundEmailInApp({ tenantId, providerId, emailData: { ...buildEmail(repeatId), subject: `Repeat inbound ${repeatId}` } });
      expect(repeat.outcome).toBe('created');
      const repeatTicket = await scopedDb.table('tickets').where({ title: `Repeat inbound ${repeatId}` }).first<any>();
      expect(repeatTicket.contact_name_id).toBe(contact.contact_name_id);
      expect(await scopedDb.table('contacts').where({ email: sender, client_id: defaults.client_id })).toHaveLength(1);

      internalSender = `internal-${crypto.randomUUID().slice(0, 8)}@${domain}`;
      const internalUserId = crypto.randomUUID();
      await scopedDb.table('users').insert({ tenant: tenantId, user_id: internalUserId, username: internalUserId, email: internalSender, hashed_password: 'unused', user_type: 'internal', is_inactive: false });
      const failedAuthId = emailIds[3];
      const failedAuthResult = await processInboundEmailInApp({ tenantId, providerId, emailData: buildEmail(failedAuthId, internalSender, `mx.example; spf=fail; dmarc=fail header.from=${domain}`) });
      expect(failedAuthResult.outcome).toBe('created');
      expect(await scopedDb.table('contacts').where({ email: internalSender })).toHaveLength(0);
      await scopedDb.table('users').where({ user_id: internalUserId }).delete();
    } finally {
      const titles = emailIds.slice(0, 2).map((id) => `Parallel inbound ${id}`);
      titles.push(`Repeat inbound ${emailIds[2]}`);
      titles.push(`Parallel inbound ${emailIds[3]}`);
      const tickets = await scopedDb.table('tickets').whereIn('title', titles).select('ticket_id');
      const ticketIds = tickets.map((ticket: any) => ticket.ticket_id);
      if (ticketIds.length) {
        await scopedDb.table('comments').whereIn('ticket_id', ticketIds).delete();
        await scopedDb.table('ticket_audit_logs').whereIn('ticket_id', ticketIds).delete();
        await scopedDb.table('tickets').whereIn('ticket_id', ticketIds).delete();
      }
      await scopedDb.table('contacts').where({ email: sender }).delete();
      if (internalSender) await scopedDb.table('users').where({ email: internalSender }).delete();
      await scopedDb.table('client_inbound_email_domains').where({ id: domainId }).delete();
      await scopedDb.table('email_providers').where({ id: providerId }).delete();
    }
  }, 120_000);
});
