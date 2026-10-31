/**
 * CM L5: a `cm2:` reply is admitted and written with the right collaboration audience by the
 * process that actually handles inbound mail, services/email-service.
 *
 * The registration under test comes from the email-service entry point (`services/email-service/src/index.ts`
 * boot: `await import('@alga-psa/co-managed/deliveryRegistration')`), never from this file. Real: the
 * database, the delivery provider's admission, the inbound writer, L4a's shared comment writer, the reply
 * parser and the capability gate (FORCE_CAPABILITIES). Stand-ins: email-service's heavy collaborators (same set
 * as services/email-service/src/index.capabilityBoot.test.ts), plus the shared-work session/admission wrappers
 * and event transport that commentAudience.crossTenant.integration.test.ts also stands in for.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { createTenant, createUser } from '../../../test-utils/testDataFactory';

const SVC = '../../../../services/email-service/src';
const noop = vi.hoisted(() => ({ start: async () => undefined }));

// ---- email-service collaborators (heavy, irrelevant to inbound comment writing) ----
vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));
vi.mock('../../../../services/email-service/src/emailService', () => ({
  EmailService: class { start() { return noop.start(); } async stop() {} getListenerStats() { return {}; } },
}));
const consumer = () => class { lastSuccessfulTickAt = null; start() { return noop.start(); } stop() {} };
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumer', () => ({ UnifiedInboundEmailQueueConsumer: consumer() }));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessor', () => ({ processUnifiedInboundEmailQueueJob: vi.fn() }));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumerV2', () => ({ UnifiedInboundEmailQueueConsumerV2: consumer() }));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessorV2', () => ({ processUnifiedInboundEmailDurableJob: vi.fn(), renewPostgresLeaseForV2Job: vi.fn() }));
vi.mock('@alga-psa/shared/services/email/inboundEmailDurableStore', () => ({ getInboundDurableMode: () => 'off' }));
vi.mock('@alga-psa/shared/services/email/inboundAuthPauseNotifier', () => ({ assertInboundAuthPauseNotifierRegistered: vi.fn() }));
vi.mock('@alga-psa/shared/services/email/inboundAuthPauseEventNotifier', () => ({ registerInboundAuthPauseEventPublisher: vi.fn() }));
vi.mock('@alga-psa/shared/services/email/inboundEmailMetrics', () => ({ installInboundEmailMetricsSink: vi.fn() }));
vi.mock('../../../../services/email-service/src/observability/registry', () => ({ createInboundEmailMetrics: () => ({ setLiveStateProvider: vi.fn() }) }));
vi.mock('../../../../services/email-service/src/observability/promSink', () => ({ createPromSink: vi.fn() }));
vi.mock('../../../../services/email-service/src/observability/healthCollector', () => ({
  collectRealSnapshot: vi.fn(), readRealQueueDepths: vi.fn(), createHealthCollector: () => ({ start: vi.fn(), stop: vi.fn(), getCache: vi.fn() }),
}));
vi.mock('../../../../services/email-service/src/observability/readiness', () => ({ createReadiness: vi.fn(() => ({})) }));
vi.mock('../../../../services/email-service/src/observability/healthServer', () => ({
  createHealthServer: () => ({ on: vi.fn(), listen: (_p: number, _h: string, cb: () => void) => cb(), close: (cb: () => void) => cb() }),
}));

// ---- shared-work admission and transport stand-ins (as in commentAudience.crossTenant) ----
const admit = async (db: Knex, actor: any, resource: any, _action: string, work: (context: any) => Promise<unknown>) => {
  const run = (trx: Knex.Transaction) => work({ trx, action: _action, actor: { tenant: actor.tenant, userId: actor.userId }, sessionId: actor.sessionId, resource, redactedFields: [] });
  return (db as any).isTransaction ? run(db as Knex.Transaction) : db.transaction(run);
};
vi.mock('../../../../packages/co-managed/src/sharedWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedSharedWork: admit }));
vi.mock('../../../../packages/co-managed/src/customerWork', async importOriginal => ({ ...(await importOriginal<any>()), withCoManagedCustomerTicket: admit }));
vi.mock('../../../../packages/co-managed/src/sharedWorkIdentity', async importOriginal => ({
  ...(await importOriginal<any>()),
  assertCoManagedSessionUnexpired: async () => {},
}));
vi.mock('../../../../packages/co-managed/src/privateParticipationEvidence', () => ({ retainCoManagedPrivateParticipation: async () => {} }));
vi.mock('@alga-psa/licensing/lifecycle', async importOriginal => ({ ...(await importOriginal<any>()), assertCoManagedOperationalWrite: async () => {} }));
vi.mock('@alga-psa/event-bus/publishers', async importOriginal => ({ ...(await importOriginal<any>()), publishStoredWorkflowEvent: vi.fn(), publishWorkflowEvent: vi.fn() }));
vi.mock('@alga-psa/tickets/lib/liveUpdates', async importOriginal => ({ ...(await importOriginal<any>()), publishTicketUpdate: vi.fn() }));

let db: Knex;
const tenants: string[] = [];
const MARK = uuidv4().slice(0, 8);
const PROVIDER_ID = uuidv4();
const aliceEmail = `alice-${MARK}@customer-it.example.test`;
let ticketTenant: string, customerTenant: string, aliceId: string, techId: string, ticketId: string;
let relationshipId: string, threadId: string, parentCommentId: string, token: string;
let processInbound: typeof import('../../../../shared/services/email/processInboundEmailInApp').processInboundEmailInApp;

function emailData(id: string, text: string) {
  return {
    id, provider: 'google', providerId: PROVIDER_ID, tenant: ticketTenant, receivedAt: new Date().toISOString(),
    from: { email: aliceEmail, name: 'Alice' }, to: [{ email: 'support@msp.example.test' }], subject: 'Re: Shared ticket',
    body: { text: `${text}\n\n[ALGA-REPLY-TOKEN ${token} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` },
    attachments: [], headers: { 'authentication-results': 'mx; spf=pass smtp.mailfrom=customer-it.example.test' },
  } as any;
}
const sharedComments = (text: string) => db('comments').where({ tenant: ticketTenant, ticket_id: ticketId }).whereRaw('note::text ILIKE ?', [`%${text}%`]);

beforeAll(async () => {
  db = await createTestDbConnection();
  process.env.FORCE_CAPABILITIES = 'co-managed:on';
  (globalThis as any).__algaWriteAdmissionState = undefined;
  (globalThis as any).__algaWriteAdmissionResolver = undefined;

  // World: a ticket tenant (psa) sharing one ticket with a co_managed workspace whose IT user (Alice) replies by mail.
  ticketTenant = await createTenant(db, 'Inbound MSP', { productCode: 'psa' });
  customerTenant = await createTenant(db, 'Inbound Customer Workspace', { productCode: 'co_managed' });
  tenants.push(ticketTenant, customerTenant);
  techId = await createUser(db, ticketTenant, { first_name: 'Morgan', last_name: 'Tech' });
  aliceId = await createUser(db, customerTenant, { first_name: 'Alice', last_name: 'CustomerIT', email: aliceEmail });
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4(), contactId = uuidv4();
  ticketId = uuidv4();
  await db('clients').insert({ tenant: ticketTenant, client_id: clientId, client_name: 'Inbound Client', billing_cycle: 'monthly', is_tax_exempt: false });
  await db('contacts').insert({ tenant: ticketTenant, contact_name_id: contactId, full_name: 'Rita Requester', email: `rita-${MARK}@example.com`, client_id: clientId });
  await db('boards').insert({ tenant: ticketTenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant: ticketTenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: techId });
  await db('statuses').insert({ tenant: ticketTenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: techId });
  await db('tickets').insert({ tenant: ticketTenant, ticket_id: ticketId, ticket_number: `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, title: 'Shared ticket', client_id: clientId,
    contact_name_id: contactId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: techId });
  relationshipId = uuidv4();
  await db('co_management_relationships').insert({ tenant: ticketTenant, relationship_id: relationshipId, sponsor_tenant: customerTenant, sponsor_client_id: clientId, state: 'active', accepted_by: aliceId, accepted_at: new Date() });
  await db('co_management_ticket_work').insert({ tenant: ticketTenant, relationship_id: relationshipId, ticket_id: ticketId, work_id: uuidv4(), revision: 1,
    responsibility: 'customer', can_collaborate: true, first_escalated_at: new Date(), last_transition_at: new Date() });

  // The shared_it comment the reply answers (real L4a writer) and the outbound cm2 reply token minted for it.
  const { createSharedTicketComment } = await import('@alga-psa/co-managed/sharedTicketCommentWriter');
  parentCommentId = uuidv4();
  threadId = parentCommentId;
  const resource = { kind: 'ticket', tenant: ticketTenant, relationshipId, id: ticketId };
  await createSharedTicketComment(db, { kind: 'session', tenant: ticketTenant, userId: techId, sessionId: uuidv4() } as any, resource as any,
    { operationId: parentCommentId, audience: 'shared_it', text: `seed-${MARK}` } as any);
  const stored = await db('comments').where({ tenant: ticketTenant, comment_id: parentCommentId }).first('thread_id');
  threadId = stored.thread_id;
  token = `cm2:${uuidv4()}`;
  await db('email_reply_tokens').insert({ tenant: ticketTenant, token, ticket_id: ticketId, comment_id: parentCommentId, entity_type: 'ticket', recipient_email: aliceEmail,
    metadata: JSON.stringify({ namespace: 'cm', version: 2, relationshipId, grantGeneration: 0, threadId }) });
}, 120_000);

afterAll(async () => {
  delete process.env.FORCE_CAPABILITIES;
  if (db) {
    try {
      const { rows } = await db.raw(`SELECT c.table_name FROM information_schema.columns c JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = 'public' AND c.column_name = 'tenant'`);
      let pending: string[] = rows.map((r: any) => r.table_name);
      for (let pass = 0; pass < 12 && pending.length; pass++) {
        const blocked: string[] = [];
        for (const table of pending) {
          try { await db.raw('DELETE FROM ?? WHERE tenant = ANY(?::uuid[])', [table, tenants]); } catch { blocked.push(table); }
        }
        if (blocked.length === pending.length) break;
        pending = blocked;
      }
      if (pending.length) process.stderr.write(`email-service inbound cleanup left tables: ${pending.join(', ')}\n`);
    } catch (error) {
      process.stderr.write(`email-service inbound cleanup skipped: ${error instanceof Error ? error.message : String(error)}\n`);
    }
    await db.destroy();
  }
});

describe('email-service boot registers co-managed inbound', () => {
  beforeAll(async () => {
    const onSpy = vi.spyOn(process, 'on').mockReturnValue(process);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
    try {
      await import('../../../../services/email-service/src/index');
      const { coManagedDeliverySeam, coManagedInboundCommentSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      // Registration is the entry point's job: wait for its async start() to have performed it.
      await vi.waitFor(() => {
        expect(coManagedDeliverySeam.hasProvider()).toBe(true);
        expect(coManagedInboundCommentSeam.hasProvider()).toBe(true);
      }, { timeout: 30_000 });
    } finally {
      onSpy.mockRestore();
      exitSpy.mockRestore();
    }
    processInbound = (await import('../../../../shared/services/email/processInboundEmailInApp')).processInboundEmailInApp;
  }, 120_000);

  it('admits a cm2 reply to a shared_it comment and writes it as the verified participant in the shared_it audience; a replay is a no-op', async () => {
    const text = `fix-applied-${MARK}`;
    const message = emailData(`<msg-${MARK}-1@customer-it.example.test>`, text);
    const result: any = await (processInbound as any)({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message }, { collectDiagnostics: true });
    expect(result).toMatchObject({ outcome: 'replied', matchedBy: 'reply_token', ticketId });

    const rows = await sharedComments(text);
    expect(rows).toHaveLength(1);
    expect(rows[0].comment_id).toBe(result.commentId);
    // Authored by the internal user resolved from the sender email (a user of the OTHER organisation, so a
    // foreign actor reference carries the identity), not by a contact or a native author of the ticket tenant.
    expect(rows[0]).toMatchObject({ user_id: null, author_type: 'internal', is_internal: true, actor_display_name: 'Alice CustomerIT' });
    expect(rows[0].contact_id ?? null).toBeNull();
    expect(await db('collaboration_actor_references').where({ tenant: ticketTenant, actor_reference_id: rows[0].actor_reference_id, actor_tenant: customerTenant, actor_user_id: aliceId })).toHaveLength(1);
    const thread = await db('comment_threads').where({ tenant: ticketTenant, thread_id: rows[0].thread_id }).first('collaboration_audience', 'is_internal');
    expect(thread).toMatchObject({ collaboration_audience: 'shared_it', is_internal: true });
    expect(rows[0].thread_id).toBe(threadId);

    // Same message delivered again: the command receipt makes it a no-op.
    await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(await sharedComments(text)).toHaveLength(1);
  });

  it('email-service writes no comment and queues one ack; the sender path sends it once; a replay adds nothing', async () => {
    const { registerWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { REFUSAL_ACK_KIND, deliverPendingRefusalAcks } = await import('@alga-psa/co-managed/refusalAck');
    const { processInboundEmailInApp } = await import('../../../../shared/services/email/processInboundEmailInApp');
    const legacy = `cm1:${uuidv4()}`;
    await db('email_reply_tokens').insert({ tenant: ticketTenant, token: legacy, ticket_id: ticketId, comment_id: parentCommentId, entity_type: 'ticket', recipient_email: aliceEmail,
      metadata: JSON.stringify({ namespace: 'cm', version: 1, relationshipId }) });
    const text = `refused-${MARK}`;
    const message = { ...emailData(`<msg-${MARK}-3@customer-it.example.test>`, text) };
    message.body = { text: `${text}\n\n[ALGA-REPLY-TOKEN ${legacy} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` };
    const acks = () => db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: REFUSAL_ACK_KIND });

    // email-service has no workflow email provider: the ack must be durably queued, not dropped.
    const result: any = await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_token_refused' });
    expect(await sharedComments(text)).toHaveLength(0);
    let rows = await acks();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'pending', recipient: aliceEmail, attempts: 0 });

    // Replaying the refused message adds no second ack.
    await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(await acks()).toHaveLength(1);

    // A process with a mail provider (server recovery job) sends it.
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({
      TenantEmailService: { getInstance: () => ({ sendEmail }) },
      StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
    } as any);
    expect(await deliverPendingRefusalAcks(ticketTenant)).toEqual({ sent: 1, failed: 0 });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect((sendEmail.mock.calls[0] as any)[0]).toMatchObject({ to: aliceEmail, headers: expect.objectContaining({ 'Auto-Submitted': expect.any(String) }) });
    rows = await acks();
    expect(rows[0]).toMatchObject({ state: 'sent', attempts: 1 });

    // Sweeping again, or replaying the refused message now that this process can send, sends nothing more.
    expect(await deliverPendingRefusalAcks(ticketTenant)).toEqual({ sent: 0, failed: 0 });
    await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(await acks()).toHaveLength(1);
    expect(await sharedComments(text)).toHaveLength(0);
    (await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry')).resetWorkflowEmailProvider();
  });
});

describe('a process where co-managed registration never ran', () => {
  it('rejects a cm2 reply with InboundRetryLaterError and writes nothing', async () => {
    // Seam slots live on globalThis; take them out for this test (what a process that never imported
    // deliveryRegistration looks like) and put them back so test order does not matter.
    const keys = ['delivery', 'inboundComment'].map(name => Symbol.for(`alga.sharedWorkSeam.${name}`));
    const host = globalThis as any;
    const saved = keys.map(key => host[key]);
    const { coManagedDeliverySeam, coManagedInboundCommentSeam, coManagedInboundOperationId } = await import('@alga-psa/shared/lib/coManagedDelivery');
    coManagedDeliverySeam.reset();
    coManagedInboundCommentSeam.reset();
    try {
      expect(coManagedDeliverySeam.hasProvider()).toBe(false);
      expect(coManagedInboundCommentSeam.hasProvider()).toBe(false);
      const { processInboundEmailInApp } = await import('../../../../shared/services/email/processInboundEmailInApp');
      const { InboundRetryLaterError } = await import('../../../../shared/services/email/inboundRetryLaterError');
      const text = `never-written-${MARK}`;
      await expect(processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: emailData(`<msg-${MARK}-2@customer-it.example.test>`, text) }))
        .rejects.toBeInstanceOf(InboundRetryLaterError);
      expect(await sharedComments(text)).toHaveLength(0);
      expect(await db('comments').where({ tenant: ticketTenant, ticket_id: ticketId }).whereRaw('note::text ILIKE ?', [`%never-written-${MARK}%`])).toHaveLength(0);
      expect(await db('co_management_command_receipts').where({ tenant: ticketTenant, operation_id: coManagedInboundOperationId(ticketTenant, ticketId, `<msg-${MARK}-2@customer-it.example.test>`) })).toHaveLength(0);
    } finally {
      keys.forEach((key, i) => { if (saved[i]) host[key] = saved[i]; });
    }
  });
});
