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
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator from '@alga-psa/emulator-msgraph';
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
let relationshipId: string, threadId: string, parentCommentId: string, token: string, requesterContactId: string;
let processInbound: typeof import('../../../../shared/services/email/processInboundEmailInApp').processInboundEmailInApp;

const ALIGNED_AUTH = 'mx.google.com; spf=pass smtp.mailfrom=customer-it.example.test; dkim=pass header.d=customer-it.example.test; dmarc=pass header.from=customer-it.example.test';

function emailData(id: string, text: string, authenticationResults: string | null = ALIGNED_AUTH, options: {
  provider?: 'google' | 'microsoft' | 'imap';
} = {}) {
  const provider = options.provider ?? 'google';
  return {
    id, provider, providerId: PROVIDER_ID, tenant: ticketTenant, receivedAt: new Date().toISOString(),
    from: { email: aliceEmail, name: 'Alice' }, to: [{ email: 'support@msp.example.test' }], subject: 'Re: Shared ticket',
    body: { text: `${text}\n\n[ALGA-REPLY-TOKEN ${token} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` },
    attachments: [], headers: authenticationResults === null ? {} : { 'authentication-results': authenticationResults },
    senderAuthentication: { provider, internalAttributionTrusted: false, contactAttributionTrusted: false, mailboxEvidence: 'mailbox_confirmation_required' },
  } as any;
}
const sharedComments = (text: string) => db('comments').where({ tenant: ticketTenant, ticket_id: ticketId }).whereRaw('note::text ILIKE ?', [`%${text}%`]);

/**
 * Boot exactly what production boots: the email-service entry point, FIRST, before the world seed below
 * imports any other co-managed module. The seed's imports pull in packages that register the capability
 * as a side effect, which is how this test used to pass while the built service had no gate. The server
 * vitest setup file registers no capability, so the only registrar here is the entry point itself.
 */
async function bootEmailService() {
  const { capabilityResolverStatus } = await import('@alga-psa/core/capability');
  expect(capabilityResolverStatus('co-managed').participation).not.toBe('registered');
  const onSpy = vi.spyOn(process, 'on').mockReturnValue(process);
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  try {
    await import('../../../../services/email-service/src/index');
    const { coManagedDeliverySeam, coManagedInboundCommentSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
    await vi.waitFor(() => {
      expect(coManagedDeliverySeam.hasProvider()).toBe(true);
      expect(coManagedInboundCommentSeam.hasProvider()).toBe(true);
    }, { timeout: 30_000 });
    expect(capabilityResolverStatus('co-managed').participation).toBe('registered');
  } finally {
    onSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

beforeAll(async () => {
  db = await createTestDbConnection();
  process.env.FORCE_CAPABILITIES = 'co-managed:on';
  (globalThis as any).__algaWriteAdmissionState = undefined;
  (globalThis as any).__algaWriteAdmissionResolver = undefined;
  await bootEmailService();

  // World: a ticket tenant (psa) sharing one ticket with a co_managed workspace whose IT user (Alice) replies by mail.
  ticketTenant = await createTenant(db, 'Inbound MSP', { productCode: 'psa' });
  customerTenant = await createTenant(db, 'Inbound Customer Workspace', { productCode: 'co_managed' });
  tenants.push(ticketTenant, customerTenant);
  techId = await createUser(db, ticketTenant, { first_name: 'Morgan', last_name: 'Tech' });
  aliceId = await createUser(db, customerTenant, { first_name: 'Alice', last_name: 'CustomerIT', email: aliceEmail });
  const clientId = uuidv4(), boardId = uuidv4(), statusId = uuidv4(), priorityId = uuidv4();
  requesterContactId = uuidv4();
  ticketId = uuidv4();
  await db('clients').insert({ tenant: ticketTenant, client_id: clientId, client_name: 'Inbound Client', billing_cycle: 'monthly', is_tax_exempt: false });
  await db('contacts').insert({ tenant: ticketTenant, contact_name_id: requesterContactId, full_name: 'Rita Requester', email: `rita-${MARK}@example.com`, client_id: clientId });
  await db('boards').insert({ tenant: ticketTenant, board_id: boardId, board_name: 'Support', is_default: true, is_inactive: false });
  await db('priorities').insert({ tenant: ticketTenant, priority_id: priorityId, priority_name: 'High', item_type: 'ticket', color: '#EF4444', order_number: 10, created_by: techId });
  await db('statuses').insert({ tenant: ticketTenant, status_id: statusId, board_id: boardId, name: 'Open', status_type: 'ticket', is_closed: false, is_default: true, order_number: 10, created_by: techId });
  await db('tickets').insert({ tenant: ticketTenant, ticket_id: ticketId, ticket_number: `T-${Date.now()}-${Math.floor(Math.random() * 1e6)}`, title: 'Shared ticket', client_id: clientId,
    contact_name_id: requesterContactId, board_id: boardId, status_id: statusId, priority_id: priorityId, entered_by: techId });
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
    processInbound = (await import('../../../../shared/services/email/processInboundEmailInApp')).processInboundEmailInApp;
  }, 120_000);

  it.each(['google', 'microsoft', 'imap', 'imap-unsigned', 'imap-forwarded'] as const)('%s asks the registered mailbox owner to confirm, then writes exactly one authorized reply', async (deliveryMode) => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { approveInboundSenderConfirmation } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
    const { processInboundEmailInApp } = await import('../../../../shared/services/email/processInboundEmailInApp');
    const priorSecret = process.env.NEXTAUTH_SECRET;
    const priorOrigin = process.env.APP_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef';
    process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({
      TenantEmailService: { getInstance: () => ({ sendEmail }) },
      StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
    } as any);
    try {
      const text = `confirmed-${deliveryMode}-${MARK}`;
      const provider = deliveryMode === 'google' ? 'google' : deliveryMode === 'microsoft' ? 'microsoft' : 'imap';
      const forgedAuth = deliveryMode === 'imap-unsigned' ? null : 'mx.google.com; dmarc=pass header.from=customer-it.example.test';
      let message = emailData(`<msg-${MARK}-${deliveryMode}@customer-it.example.test>`, text, forgedAuth, { provider });
      if (deliveryMode === 'imap-forwarded') {
        message.body.text = `FYI ${text}; please review the message I forwarded below.\n\nForwarded message follows:\nFrom: victim@customer-it.example.test\nAuthentication-Results: mx.google.com; dmarc=pass header.from=customer-it.example.test\n\n${message.body.text}`;
      }
      if (provider === 'google') {
        const { GmailAdapter } = await import('../../../../shared/services/email/providers/GmailAdapter');
        const raw = Buffer.from([
          `From: Alice <${aliceEmail}>`, 'To: support@msp.example.test', 'Subject: Re: Shared ticket',
          'Message-ID: <gmail-adapter-confirmation@example.test>',
          ...(forgedAuth ? [`Authentication-Results: ${forgedAuth}`, `Authentication-Results: attacker.example; dmarc=pass header.from=customer-it.example.test`] : []),
          '', message.body.text,
        ].join('\r\n'));
        const headerPairs = ['From', 'To', 'Subject', 'Message-ID'].map((name) => ({
          name, value: raw.toString().split('\r\n').find((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`))!.slice(name.length + 1).trim(),
        }));
        if (forgedAuth) headerPairs.push({ name: 'Authentication-Results', value: forgedAuth }, { name: 'Authentication-Results', value: 'attacker.example; dmarc=pass header.from=customer-it.example.test' });
        const adapter = new GmailAdapter({ id: PROVIDER_ID, tenant: ticketTenant, name: 'Gmail fixture', provider_type: 'google', mailbox: 'support@msp.example.test', folder_to_monitor: 'INBOX', active: true, webhook_notification_url: '', connection_status: 'connected', created_at: new Date().toISOString(), updated_at: new Date().toISOString() } as any);
        (adapter as any).gmail = { users: { messages: { get: async () => ({ data: { id: 'gmail-adapter-confirmation', labelIds: ['INBOX'], payload: { headers: headerPairs, body: { data: Buffer.from(message.body.text).toString('base64') } } } }) } } };
        (adapter as any).downloadMessageSource = async () => raw;
        message = await adapter.getMessageDetails('gmail-adapter-confirmation') as any;
      } else if (provider === 'imap') {
        const { simpleParser } = await import('mailparser');
        const { mapParsedMimeToEmailMessageDetails } = await vi.importActual<typeof import('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessor')>('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessor');
        const raw = Buffer.from(`From: Alice <${aliceEmail}>\r\nTo: support@msp.example.test\r\nSubject: Re: Shared ticket\r\nAuthentication-Results: mx.google.com; dmarc=pass header.from=customer-it.example.test\r\n\r\n${message.body.text}`);
        message = await mapParsedMimeToEmailMessageDetails({ provider: 'imap', providerId: PROVIDER_ID, tenant: ticketTenant, rawMimeBuffer: raw, parsed: await simpleParser(raw), fallbackMessageId: `imap-adapter-${deliveryMode}-${MARK}` }) as any;
      }
      const result: any = await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
      expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_confirmation_requested', ticketId });
      expect(await sharedComments(text)).toHaveLength(0);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((sendEmail.mock.calls[0] as any)[0]).toMatchObject({ to: aliceEmail });
      const emailArgs = (sendEmail.mock.calls[0] as any)[0];
      const processor = emailArgs.templateProcessor;
      const confirmationUrl = String(processor.text).match(/https:\/\/[^\s]+/)?.[0];
      expect(confirmationUrl).toBeTruthy();
      const confirmationToken = new URL(confirmationUrl!).searchParams.get('token')!;
      const wrongActor = await approveInboundSenderConfirmation(confirmationToken, {
        tenant: ticketTenant, user_id: techId, user_type: 'internal', email: 'other@msp.example.test',
      });
      expect(wrongActor).toBeNull();
      expect(await sharedComments(text)).toHaveLength(0);
      const approved = await approveInboundSenderConfirmation(confirmationToken, {
        tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail,
      });
      expect(approved).toMatchObject({ ticketId });
      expect(await sharedComments(text)).toHaveLength(1);
      expect(await approveInboundSenderConfirmation(confirmationToken, {
        tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail,
      })).toBeNull();
      expect(await sharedComments(text)).toHaveLength(1);
      const row = (await sharedComments(text))[0];
      expect(row).toMatchObject({ author_type: 'internal', actor_display_name: 'Alice CustomerIT', is_internal: true });
    } finally {
      resetWorkflowEmailProvider();
      if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret;
      if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin;
    }
  });

  it('fetches forged Graph Sender/From MIME through the real adapter and requires Alice confirmation before its single comment', async () => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { approveInboundSenderConfirmation } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
    const { MicrosoftGraphAdapter } = await import('../../../../shared/services/email/providers/MicrosoftGraphAdapter');
    const { mapParsedMimeToEmailMessageDetails } = await vi.importActual<typeof import('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessor')>('../../../../shared/services/email/unifiedInboundEmailQueueJobProcessor');
    const { simpleParser } = await import('mailparser');
    const priorSecret = process.env.NEXTAUTH_SECRET, priorOrigin = process.env.APP_BASE_URL;
    const priorGraphUrl = process.env.MICROSOFT_GRAPH_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef';
    process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({
      TenantEmailService: { getInstance: () => ({ sendEmail }) },
      StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
    } as any);
    const host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
    try {
      const { controlPort, ports } = await host.start();
      const graphBaseUrl = `http://127.0.0.1:${ports.msgraph}/v1.0`;
      process.env.MICROSOFT_GRAPH_BASE_URL = graphBaseUrl;
      const controlUrl = `http://127.0.0.1:${controlPort}`;
      const post = async (path: string, body: unknown) => fetch(`${controlUrl}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      }).then((r) => r.json() as Promise<any>);
      const clientId = `inbound-${MARK}`, clientSecret = 'inbound-test-secret';
      expect((await post('/control/msgraph/seed/client', { clientId, clientSecret })).ok).toBe(true);
      const redirectUri = 'http://localhost/inbound-test-callback';
      const authorize = new URL(`${graphBaseUrl.replace('/v1.0', '')}/common/oauth2/v2.0/authorize`);
      authorize.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: 'Mail.Read User.Read' }).toString();
      const authorization = await fetch(authorize, { redirect: 'manual' });
      const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
      const tokenResponse = await fetch(`${graphBaseUrl.replace('/v1.0', '')}/common/oauth2/v2.0/token`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
      });
      const accessToken = (await tokenResponse.json()).access_token;
      const text = `graph-emulator-confirm-${MARK}`;
      const seeded = await post('/control/msgraph/seed/message', {
        from: aliceEmail, sender: aliceEmail, to: 'support@msp.example.test', subject: 'Re: Shared ticket',
        body: `${text}\n\n[ALGA-REPLY-TOKEN ${token} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]`,
        authenticationResults: 'outlook.com; dkim=pass header.d=customer-it.example.test; dmarc=pass header.from=customer-it.example.test',
        headers: [
          { name: 'X-MS-Exchange-Organization-AuthSource', value: 'trusted-looking.exchange.example.test' },
          { name: 'X-MS-Exchange-Organization-AuthAs', value: 'Internal' },
          { name: 'Authentication-Results', value: 'attacker.example; dmarc=pass header.from=customer-it.example.test' },
          { name: 'Message-ID', value: '<forged-provider-identity@attacker.example>' },
        ],
      });
      expect(seeded.ok).toBe(true);
      const graphRepresentation = await fetch(`${graphBaseUrl}/me/messages/${seeded.result.id}`, {
        headers: { authorization: `Bearer ${accessToken}` },
      }).then((response) => response.json() as Promise<any>);
      expect(graphRepresentation.sender.emailAddress.address).toBe(aliceEmail);
      const adapter = new MicrosoftGraphAdapter({
        id: PROVIDER_ID, tenant: ticketTenant, name: 'Emulated inbound', provider_type: 'microsoft', mailbox: 'support@msp.example.test',
        folder_to_monitor: 'Inbox', active: true, webhook_notification_url: '', connection_status: 'connected',
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        provider_config: { access_token: accessToken, refresh_token: 'unused', token_expires_at: new Date(Date.now() + 3600_000).toISOString() },
      } as any);
      await adapter.connect();
      const rawMimeBuffer = await adapter.downloadMessageSource(seeded.result.id);
      const parsed = await simpleParser(rawMimeBuffer);
      const email = await mapParsedMimeToEmailMessageDetails({
        provider: 'microsoft', providerId: PROVIDER_ID, tenant: ticketTenant,
        rawMimeBuffer, parsed, fallbackMessageId: seeded.result.id,
      });
      expect(email.from.email).toBe(aliceEmail);
      expect(email.senderAuthentication?.author.authorization).toBe('confirmation_required');
      expect(email.senderAuthentication?.diagnostics?.authenticationResults).toEqual([
        'outlook.com; dkim=pass header.d=customer-it.example.test; dmarc=pass header.from=customer-it.example.test',
        'attacker.example; dmarc=pass header.from=customer-it.example.test',
      ]);
      expect(email.providerIdentity).toContain(seeded.result.id);
      const result: any = await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: email as any });
      expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_confirmation_requested', ticketId });
      expect(await sharedComments(text)).toHaveLength(0);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      const sentArgs = (sendEmail.mock.calls[0] as any)[0];
      const confirmationUrl = String(sentArgs.templateProcessor.text).match(/https:\/\/[^\s]+/)?.[0];
      const confirmationToken = new URL(confirmationUrl!).searchParams.get('token')!;
      expect(await approveInboundSenderConfirmation(confirmationToken, {
        tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail,
      })).toMatchObject({ ticketId });
      expect(await sharedComments(text)).toHaveLength(1);
      const row = (await sharedComments(text))[0];
      expect(row).toMatchObject({ author_type: 'internal', actor_display_name: 'Alice CustomerIT', is_internal: true });
    } finally {
      await host.stop();
      resetWorkflowEmailProvider();
      if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret;
      if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin;
      if (priorGraphUrl === undefined) delete process.env.MICROSOFT_GRAPH_BASE_URL; else process.env.MICROSOFT_GRAPH_BASE_URL = priorGraphUrl;
    }
  }, 60_000);

  it('retries a provider-reported confirmation failure and recovers stale send claims without duplicate comments', async () => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { deliverPendingSenderConfirmations, approveInboundSenderConfirmation } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
    const priorSecret = process.env.NEXTAUTH_SECRET, priorOrigin = process.env.APP_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef'; process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn().mockResolvedValueOnce({ success: false, error: 'rate limited', metadata: { errorCode: 'rate_limit' } }).mockResolvedValue({ success: true });
    registerWorkflowEmailProvider({ TenantEmailService: { getInstance: () => ({ sendEmail }) }, StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } } } as any);
    try {
      const text = `send-recovery-${MARK}`;
      const message = emailData(`<send-recovery-${MARK}@customer-it.example.test>`, text, null, { provider: 'microsoft' });
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
      const row = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation' }).orderBy('created_at', 'desc').first('source_id', 'state', 'payload');
      expect(row.state).toBe('failed');
      expect(await sharedComments(text)).toHaveLength(0);
      // Simulate interruption after claim: no provider result was finalized.
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: row.source_id })
        .update({ state: 'sending', payload: { ...row.payload, state: 'pending', deliveryAttemptId: uuidv4() }, updated_at: new Date(Date.now() - 61_000) });
      const claimRecovery = await Promise.all([deliverPendingSenderConfirmations(ticketTenant), deliverPendingSenderConfirmations(ticketTenant)]);
      expect(claimRecovery.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
      const sentRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: row.source_id }).first('payload');
      const token = new URL(String((sendEmail.mock.calls[1] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)![0]).searchParams.get('token')!;
      // Model a process interruption after the provider accepted the email but before finalization.
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: row.source_id })
        .update({ state: 'sending', payload: { ...sentRow.payload, state: 'pending', deliveryAttemptId: uuidv4() }, updated_at: new Date(Date.now() - 61_000) });
      expect((await deliverPendingSenderConfirmations(ticketTenant)).sent).toBe(1);
      const approved = await approveInboundSenderConfirmation(token, { tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail });
      expect(approved).toMatchObject({ ticketId });
      expect(await approveInboundSenderConfirmation(token, { tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail })).toBeNull();
      expect(await sharedComments(text)).toHaveLength(1);
      expect(sendEmail).toHaveBeenCalledTimes(3);
    } finally { resetWorkflowEmailProvider(); if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret; if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin; }
  });

  it('confirms an unsigned Microsoft reply from the registered requester contact before native admission and persistence', async () => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { approveInboundContactSenderConfirmation } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
    const priorSecret = process.env.NEXTAUTH_SECRET, priorOrigin = process.env.APP_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef'; process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({ TenantEmailService: { getInstance: () => ({ sendEmail }) }, StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } } } as any);
    try {
      const contactEmail = `rita-${MARK}@example.com`, contactText = `unsigned-contact-${MARK}`;
      const nativeToken = `native:${uuidv4()}`;
      await db('email_reply_tokens').insert({ tenant: ticketTenant, token: nativeToken, ticket_id: ticketId, comment_id: parentCommentId, entity_type: 'ticket', recipient_email: contactEmail, metadata: null });
      const message = { ...emailData(`<unsigned-contact-${MARK}@outlook.example.test>`, contactText, null, { provider: 'microsoft' }), from: { email: contactEmail, name: 'Rita Requester' }, body: { text: `${contactText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      const { coManagedInboundCommentSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      const { registerCoManagedInboundCommentWriter } = await import('@alga-psa/co-managed/inboundCommentWriter');
      coManagedInboundCommentSeam.reset();
      expect(coManagedInboundCommentSeam.hasProvider()).toBe(false);
      const initial: any = await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
      // Restore the optional capability after demonstrating the ordinary PSA fallback.
      registerCoManagedInboundCommentWriter();
      expect(initial).toMatchObject({ outcome: 'quarantined', reason: 'unauthorized_thread_header_sender', ticketId });
      expect(await sharedComments(contactText)).toHaveLength(0);
      const url = String((sendEmail.mock.calls[0] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)?.[0];
      expect((sendEmail.mock.calls[0] as any)[0].to).toBe(contactEmail);
      const token = new URL(url!).searchParams.get('token')!;
      const approved: any = await approveInboundContactSenderConfirmation(token);
      expect(approved).toMatchObject({ outcome: 'replied', ticketId });
      expect(await sharedComments(contactText)).toHaveLength(1);
      expect((await sharedComments(contactText))[0]).toMatchObject({ author_type: 'client', contact_id: requesterContactId });
      expect(await approveInboundContactSenderConfirmation(token)).toBeNull();
      expect(await sharedComments(contactText)).toHaveLength(1);

      const alteredText = `altered-contact-${MARK}`;
      const alteredMessage = { ...message, id: `<altered-contact-${MARK}@outlook.example.test>`, body: { text: `${alteredText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: alteredMessage });
      const contactRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_contact_confirmation' }).orderBy('created_at', 'desc').first('source_id', 'payload');
      const alteredUrl = String((sendEmail.mock.calls[1] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)![0];
      const alteredToken = new URL(alteredUrl).searchParams.get('token')!;
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_contact_confirmation', source_id: contactRow.source_id })
        .update({ payload: { ...contactRow.payload, emailData: { ...contactRow.payload.emailData, body: { text: 'replaced after confirmation email' } } } });
      expect(await approveInboundContactSenderConfirmation(alteredToken)).toBeNull();
      expect(await sharedComments(alteredText)).toHaveLength(0);

      const forgedText = `forged-contact-${MARK}`;
      const forged = { ...message, id: `<forged-contact-${MARK}@attacker.example.test>`, from: { email: `victim-${MARK}@example.com`, name: 'Victim' },
        headers: { 'authentication-results': 'outlook.com; dkim=pass header.d=example.com; dmarc=pass header.from=example.com', 'x-ms-exchange-organization-authas': 'Internal' },
        body: { text: `${forgedText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      const forgedResult: any = await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: forged });
      expect(forgedResult.outcome).toBe('quarantined');
      expect(await sharedComments(forgedText)).toHaveLength(0);

      const interruptedText = `contact-interrupted-after-persist-${MARK}`;
      const interruptedMessage = { ...message, id: `<contact-interrupted-${MARK}@outlook.example.test>`, body: { text: `${interruptedText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: interruptedMessage });
      const interruptedUrl = String((sendEmail.mock.calls[2] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)![0];
      const interruptedToken = new URL(interruptedUrl).searchParams.get('token')!;
      const processModule = await import('../../../../shared/services/email/processInboundEmailInApp');
      const originalProcess = processModule.processInboundEmailInApp;
      const persistThenInterrupt = vi.spyOn(processModule, 'processInboundEmailInApp').mockImplementationOnce(async (...args: any[]) => {
        await originalProcess(...args);
        throw new Error('simulated process interruption after comment persistence');
      });
      await expect(approveInboundContactSenderConfirmation(interruptedToken)).rejects.toThrow('simulated process interruption');
      persistThenInterrupt.mockRestore();
      expect(await sharedComments(interruptedText)).toHaveLength(1);
      expect(await approveInboundContactSenderConfirmation(interruptedToken)).toMatchObject({ outcome: 'deduped', ticketId });
      expect(await sharedComments(interruptedText)).toHaveLength(1);

      const overlapText = `contact-overlapping-approval-${MARK}`;
      const overlapMessage = { ...message, id: `<contact-overlap-${MARK}@outlook.example.test>`, body: { text: `${overlapText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: overlapMessage });
      const overlapUrl = String((sendEmail.mock.calls[3] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)![0];
      const overlapToken = new URL(overlapUrl).searchParams.get('token')!;
      const overlapResults = await Promise.all([
        approveInboundContactSenderConfirmation(overlapToken),
        approveInboundContactSenderConfirmation(overlapToken),
      ]);
      expect(overlapResults.filter(Boolean)).toHaveLength(1);
      expect(await sharedComments(overlapText)).toHaveLength(1);

      const inactiveText = `contact-deactivated-${MARK}`;
      const inactiveMessage = { ...message, id: `<contact-inactive-${MARK}@outlook.example.test>`, body: { text: `${inactiveText}\n\n[ALGA-REPLY-TOKEN ${nativeToken} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` } };
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: inactiveMessage });
      const inactiveUrl = String((sendEmail.mock.calls[4] as any)[0].templateProcessor.text).match(/https:\/\/[^\s]+/)![0];
      const inactiveToken = new URL(inactiveUrl).searchParams.get('token')!;
      const watchListBefore = (await db('tickets').where({ tenant: ticketTenant, ticket_id: ticketId }).first('attributes')).attributes;
      await db('contacts').where({ tenant: ticketTenant, contact_name_id: requesterContactId }).update({ is_inactive: true });
      try {
        expect(await approveInboundContactSenderConfirmation(inactiveToken)).toBeNull();
        expect(await sharedComments(inactiveText)).toHaveLength(0);
        expect((await db('tickets').where({ tenant: ticketTenant, ticket_id: ticketId }).first('attributes')).attributes).toEqual(watchListBefore);
      } finally {
        await db('contacts').where({ tenant: ticketTenant, contact_name_id: requesterContactId }).update({ is_inactive: false });
      }
      expect(sendEmail).toHaveBeenCalledTimes(5);
    } finally { resetWorkflowEmailProvider(); if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret; if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin; }
  });

  it('confirmation rejects expiry, content changes and revoked grants, and concurrent redemption writes one comment', async () => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { approveInboundSenderConfirmation } = await import('@alga-psa/co-managed/inboundSenderConfirmation');
    const priorSecret = process.env.NEXTAUTH_SECRET, priorOrigin = process.env.APP_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef';
    process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({
      TenantEmailService: { getInstance: () => ({ sendEmail }) },
      StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
    } as any);
    const actor = { tenant: customerTenant, user_id: aliceId, user_type: 'internal', email: aliceEmail };
    const request = async (label: string) => {
      const text = `confirmation-edge-${label}-${MARK}`;
      const message = emailData(`<msg-${label}-${MARK}@customer-it.example.test>`, text, null, { provider: 'microsoft' });
      await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
      const sent = (sendEmail.mock.calls.at(-1) as any)[0];
      const url = String(sent.templateProcessor.text).match(/https:\/\/[^\s]+/)?.[0];
      const confirmationToken = new URL(url!).searchParams.get('token')!;
      const claim = JSON.parse(Buffer.from(confirmationToken.split('.')[0], 'base64url').toString());
      return { text, confirmationToken, sourceId: claim.sourceId };
    };
    try {
      const expired = await request('expired');
      const expiredRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: expired.sourceId }).first('payload');
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: expired.sourceId }).update({ payload: { ...expiredRow.payload, expiresAt: new Date(Date.now() - 60_000).toISOString() } });
      expect(await approveInboundSenderConfirmation(expired.confirmationToken, actor)).toBeNull();
      expect(await sharedComments(expired.text)).toHaveLength(0);

      const changed = await request('changed');
      const changedRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: changed.sourceId }).first('payload');
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: changed.sourceId }).update({ payload: { ...changedRow.payload, text: 'tampered after the confirmation email' } });
      expect(await approveInboundSenderConfirmation(changed.confirmationToken, actor)).toBeNull();
      expect(await sharedComments(changed.text)).toHaveLength(0);

      const revoked = await request('revoked');
      await db('co_management_ticket_work').where({ tenant: ticketTenant, ticket_id: ticketId }).update({ grant_revoked_at: new Date() });
      expect(await approveInboundSenderConfirmation(revoked.confirmationToken, actor)).toBeNull();
      expect(await sharedComments(revoked.text)).toHaveLength(0);
      await db('co_management_ticket_work').where({ tenant: ticketTenant, ticket_id: ticketId }).update({ grant_revoked_at: null });

      const concurrent = await request('concurrent');
      const results = await Promise.all([
        approveInboundSenderConfirmation(concurrent.confirmationToken, actor),
        approveInboundSenderConfirmation(concurrent.confirmationToken, actor),
      ]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(await sharedComments(concurrent.text)).toHaveLength(1);

      const interruptedBeforeWrite = await request('interrupted-before-write');
      const beforeRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: interruptedBeforeWrite.sourceId }).first('payload');
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: interruptedBeforeWrite.sourceId })
        .update({ payload: { ...beforeRow.payload, state: 'redeeming', redemptionId: uuidv4() }, updated_at: new Date(Date.now() - 61_000) });
      expect(await approveInboundSenderConfirmation(interruptedBeforeWrite.confirmationToken, actor)).toMatchObject({ ticketId });
      expect(await sharedComments(interruptedBeforeWrite.text)).toHaveLength(1);

      const activeClaim = await request('active-claim');
      const activeRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: activeClaim.sourceId }).first('payload');
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: activeClaim.sourceId })
        .update({ payload: { ...activeRow.payload, state: 'redeeming', redemptionId: uuidv4() }, updated_at: new Date() });
      expect(await approveInboundSenderConfirmation(activeClaim.confirmationToken, actor)).toBeNull();
      expect(await sharedComments(activeClaim.text)).toHaveLength(0);

      const interruptedAfterWrite = await request('interrupted-after-write');
      const afterRow = await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: interruptedAfterWrite.sourceId }).first('payload');
      const { coManagedInboundCommentSeam } = await import('@alga-psa/shared/lib/coManagedDelivery');
      const writer = await coManagedInboundCommentSeam.resolve(ticketTenant);
      expect(writer).toBeTruthy();
      await writer!.write({
        tenant: afterRow.payload.tenant,
        ticketId: afterRow.payload.ticketId,
        relationshipId: afterRow.payload.relationshipId,
        threadId: afterRow.payload.threadId,
        parentCommentId: afterRow.payload.parentCommentId,
        audience: afterRow.payload.audience,
        actor: afterRow.payload.actor,
        operationId: afterRow.payload.operationId,
        text: afterRow.payload.text,
      });
      expect(await sharedComments(interruptedAfterWrite.text)).toHaveLength(1);
      await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation', source_id: interruptedAfterWrite.sourceId })
        .update({ payload: { ...afterRow.payload, state: 'redeeming', redemptionId: uuidv4() }, updated_at: new Date(Date.now() - 61_000) });
      expect(await approveInboundSenderConfirmation(interruptedAfterWrite.confirmationToken, actor)).toMatchObject({ ticketId });
      expect(await sharedComments(interruptedAfterWrite.text)).toHaveLength(1);
    } finally {
      resetWorkflowEmailProvider();
      if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret;
      if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin;
    }
  });

  it('does not let forged Gmail headers attribute Alice until she confirms the exact pending message', async () => {
    const { registerWorkflowEmailProvider, resetWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const priorSecret = process.env.NEXTAUTH_SECRET, priorOrigin = process.env.APP_BASE_URL;
    process.env.NEXTAUTH_SECRET = 'confirmation-test-secret-0123456789-abcdef';
    process.env.APP_BASE_URL = 'https://psa.example.test';
    const sendEmail = vi.fn(async () => ({ success: true }));
    registerWorkflowEmailProvider({
      TenantEmailService: { getInstance: () => ({ sendEmail }) },
      StaticTemplateProcessor: class { constructor(public subject: string, public html: string, public text?: string) {} async process() { return { subject: this.subject, html: this.html, text: this.text }; } },
    } as any);
    try {
      const text = `forged-google-headers-${MARK}`;
      const forged = emailData(`<msg-${MARK}-forged-google@customer-it.example.test>`, text,
        'mx.google.com; dmarc=pass header.from=customer-it.example.test', { provider: 'google', authenticatedMailbox: null });
      const result: any = await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: forged });
      expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_confirmation_requested' });
      expect(await sharedComments(text)).toHaveLength(0);
      expect(sendEmail).toHaveBeenCalledTimes(1);
      expect((sendEmail.mock.calls[0] as any)[0]).toMatchObject({ to: aliceEmail });
    } finally {
      resetWorkflowEmailProvider();
      if (priorSecret === undefined) delete process.env.NEXTAUTH_SECRET; else process.env.NEXTAUTH_SECRET = priorSecret;
      if (priorOrigin === undefined) delete process.env.APP_BASE_URL; else process.env.APP_BASE_URL = priorOrigin;
    }
  });

  it('rejects a forged address that does not resolve to an active participant before any comment write', async () => {
    const strangerTenant = await createTenant(db, `Inbound Stranger ${MARK}`, { productCode: 'psa' });
    tenants.push(strangerTenant);
    const strangerId = await createUser(db, strangerTenant, { first_name: 'Sam', last_name: 'Stranger', email: `stranger-${MARK}@unrelated.example.test` });
    const text = `cross-tenant-denied-${MARK}`;
    const message = emailData(`<msg-${MARK}-stranger@unrelated.example.test>`, text, ALIGNED_AUTH, { provider: 'microsoft' });
    message.from.email = `stranger-${MARK}@unrelated.example.test`;
    const result: any = await processInbound({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_sender_unauthenticated' });
    expect(await sharedComments(text)).toHaveLength(0);
    expect(await db('users').where({ tenant: strangerTenant, user_id: strangerId })).toHaveLength(1);
  });

  it('email-service writes no comment and queues one ack; the sender path sends it once; a replay adds nothing', async () => {
    const { registerWorkflowEmailProvider } = await import('@alga-psa/shared/workflow/runtime/registries/workflowEmailRegistry');
    const { REFUSAL_ACK_KIND, deliverPendingRefusalAcks } = await import('@alga-psa/co-managed/refusalAck');
    const { processInboundEmailInApp } = await import('../../../../shared/services/email/processInboundEmailInApp');
    // Earlier confirmation cases intentionally ran without a mail provider, leaving durable
    // confirmation intents pending. Keep this refusal-ack assertion isolated from that queue.
    await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: 'sender_confirmation' }).update({ state: 'sent' });
    await db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: REFUSAL_ACK_KIND }).where('state', 'pending').update({ state: 'sent' });
    const legacy = `cm1:${uuidv4()}`;
    await db('email_reply_tokens').insert({ tenant: ticketTenant, token: legacy, ticket_id: ticketId, comment_id: parentCommentId, entity_type: 'ticket', recipient_email: aliceEmail,
      metadata: JSON.stringify({ namespace: 'cm', version: 1, relationshipId }) });
    const text = `refused-${MARK}`;
    const message = { ...emailData(`<msg-${MARK}-3@customer-it.example.test>`, text) };
    message.body = { text: `${text}\n\n[ALGA-REPLY-TOKEN ${legacy} ticketId=${ticketId} commentId=${parentCommentId} threadId=${threadId}]` };
    const acks = () => db('co_management_deliveries').where({ tenant: ticketTenant, delivery_kind: REFUSAL_ACK_KIND });
    const ackCountBefore = (await acks()).length;

    // email-service has no workflow email provider: the ack must be durably queued, not dropped.
    const result: any = await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(result).toMatchObject({ outcome: 'quarantined', reason: 'co_managed_token_refused' });
    expect(await sharedComments(text)).toHaveLength(0);
    let rows = await acks();
    expect(rows).toHaveLength(ackCountBefore + 1);
    expect(rows[0]).toMatchObject({ state: 'pending', recipient: aliceEmail, attempts: 0 });

    // Replaying the refused message adds no second ack.
    await processInboundEmailInApp({ tenantId: ticketTenant, providerId: PROVIDER_ID, emailData: message });
    expect(await acks()).toHaveLength(ackCountBefore + 1);

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
    const keys = ['delivery', 'inbound-comment'].map(name => Symbol.for(`alga.sharedWorkSeam.${name}`));
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
