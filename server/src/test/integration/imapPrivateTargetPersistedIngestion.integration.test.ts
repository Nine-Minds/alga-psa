/**
 * Real private/custom-port IMAP ingestion check. This intentionally starts only
 * the production EmailService listener, an HTTP adapter that invokes the real
 * integrations POST handler, and the production durable queue consumer. It does
 * not start the Next/application server.
 *
 * Requires the dedicated GreenMail review fixture at 172.17.0.31:143 and local
 * test Postgres/Redis services. All database, Redis, storage, and mailbox state
 * is unique to this run and removed in finally.
 */
import dotenv from 'dotenv';
import { createServer, type Server } from 'node:http';
import net, { type Server as NetServer, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { it } from 'vitest';

const root = process.cwd();
dotenv.config({ path: path.join(root, 'server/.env.local'), override: false });

const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const dbName = `imap_private_ingest_${suffix}`;
const redisPrefix = `imap-review-${suffix}`;
const scratchStorage = await fs.mkdtemp(path.join(os.tmpdir(), 'alga-imap-ingest-'));
const privateGateway = '172.17.0.1';
const greenMailAddress = '172.17.0.31';
const customImapPort = 1143;
const postgresPort = Number(process.env.IMAP_INGEST_TEST_DB_PORT || 26462);
const redisPort = Number(process.env.IMAP_INGEST_TEST_REDIS_PORT || 26463);
const mailbox = 'review@example.test';
const mailboxUser = 'review';
const mailboxPassword = 'review-mail-password';
const messageId = `private-imap-${suffix}@example.test`;
const subject = `Private custom-port ingestion ${suffix}`;
const bodyText = `Unique review fixture ${suffix}`;
const webhookSecret = `review-${randomUUID()}`;

let db: any;
let service: any;
let adapter: Server | undefined;
let relay: NetServer | undefined;
let relaySockets = new Set<Socket>();
let adapterPort: number | undefined;
let tenantId: string | undefined;
let providerId: string | undefined;
let defaultsId: string | undefined;
let imapFlowModule: any;
let redisClient: any;
let greenMailMessageUid: number | undefined;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor<T>(label: string, read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  let last: T;
  do {
    last = await read();
    if (done(last)) return last;
    await sleep(250);
  } while (Date.now() < until);
  throw new Error(`Timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function listen(server: Server | NetServer, port = 0, host = '127.0.0.1'): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolve());
  });
  return (server.address() as any).port;
}

async function closeServer(server?: Server | NetServer): Promise<void> {
  if (!server) return;
  for (const socket of relaySockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function createImapClient(host: string, port: number) {
  const client = new imapFlowModule.ImapFlow({
    host,
    port,
    secure: false,
    auth: { user: mailboxUser, pass: mailboxPassword },
    logger: false,
    tls: { rejectUnauthorized: true },
  });
  await client.connect();
  return client;
}

async function removeGreenMailMessage(): Promise<void> {
  if (!imapFlowModule) return;
  try {
    const client = await createImapClient(privateGateway, customImapPort);
    try {
      await client.mailboxOpen('INBOX');
      const matchingUids: number[] = [];
      for await (const item of client.fetch('1:*', { uid: true, envelope: true }, { uid: true })) {
        const id = item.envelope?.messageId || '';
        const itemSubject = item.envelope?.subject || '';
        if (id.startsWith('<private-imap-') && itemSubject.startsWith('Private custom-port ingestion ')) {
          matchingUids.push(item.uid);
        }
      }
      if (matchingUids.length) {
        const lock = await client.getMailboxLock('INBOX');
        try {
          await client.messageDelete(matchingUids, { uid: true });
        } finally {
          lock.release();
        }
      }
      await client.logout();
    } catch (error) {
      try { await client.logout(); } catch { /* cleanup best effort */ }
      throw error;
    }
  } catch (error) {
    console.warn('fixture mailbox cleanup could not remove test message:', (error as Error).message);
  }
}

async function main(): Promise<void> {
  const readSecret = async (name: string) => (await readFile(path.join(root, 'secrets', name), 'utf8')).trim();
  process.env.NODE_ENV = 'test';
  process.env.APP_ENV = 'development';
  process.env.DB_HOST = '127.0.0.1';
  process.env.DB_HOST_ADMIN = '127.0.0.1';
  process.env.DB_PORT = String(postgresPort);
  process.env.DB_PORT_ADMIN = String(postgresPort);
  process.env.DB_NAME_SERVER = dbName;
  process.env.DB_USER_ADMIN = 'postgres';
  process.env.DB_USER_SERVER = 'app_user';
  process.env.DB_PASSWORD_ADMIN = await readSecret('postgres_password');
  process.env.DB_PASSWORD_SERVER = await readSecret('db_password_server');
  process.env.REDIS_HOST = '127.0.0.1';
  process.env.REDIS_PORT = String(redisPort);
  process.env.REDIS_PASSWORD = '';
  process.env.SECRET_READ_CHAIN = 'env';
  process.env.STORAGE_DEFAULT_PROVIDER = 'local';
  process.env.STORAGE_LOCAL_BASE_PATH = scratchStorage;
  process.env.UNIFIED_INBOUND_EMAIL_DURABLE_MODE = 'enforce';
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_READY_KEY = `${redisPrefix}:ready`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_PROCESSING_KEY = `${redisPrefix}:processing`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_HASH_KEY = `${redisPrefix}:inflight`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_LEASE_KEY = `${redisPrefix}:leases`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_KEY = `${redisPrefix}:delayed`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_DATA_KEY = `${redisPrefix}:delayed-data`;
  process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DLQ_KEY = `${redisPrefix}:dead`;
  process.env.IMAP_STARTUP_STAGGER_MS = '0';
  process.env.IMAP_PROVIDER_REFRESH_MS = '60000';
  process.env.IMAP_IDLE_POLL_MS = '500';
  process.env.IMAP_POLL_INTERVAL_MS = '500';
  process.env.IMAP_CONNECTION_TIMEOUT_MS = '3000';
  process.env.IMAP_WEBHOOK_SECRET = webhookSecret;

  const { createTestDbConnection } = await import('../../../test-utils/dbConfig');
  db = await createTestDbConnection({ databaseName: dbName, runSeeds: true });
  const tenant = await db('tenants').first('tenant');
  assert.ok(tenant?.tenant, 'seeded test tenant exists');
  tenantId = tenant.tenant;

  const client = await db('clients').where({ tenant: tenantId }).first('client_id');
  const status = await db('statuses').where({ tenant: tenantId, status_type: 'ticket', is_default: true })
    .whereNotNull('board_id').first('status_id', 'board_id');
  const priority = await db('priorities').where({ tenant: tenantId }).first('priority_id');
  const user = await db('users').where({ tenant: tenantId }).first('user_id');
  assert.ok(client?.client_id && status?.status_id && status?.board_id && priority?.priority_id && user?.user_id,
    'seeded client, default status, priority, and user exist');

  defaultsId = randomUUID();
  providerId = randomUUID();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `imap-review-${suffix}`,
    display_name: `IMAP review ${suffix}`,
    description: 'Isolated private IMAP ingestion validation',
    board_id: status.board_id,
    status_id: status.status_id,
    priority_id: priority.priority_id,
    client_id: client.client_id,
    entered_by: user.user_id,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('email_providers').insert({
    id: providerId,
    tenant: tenantId,
    provider_type: 'imap',
    provider_name: `IMAP review ${suffix}`,
    mailbox,
    is_active: true,
    status: 'configuring',
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  await db('imap_email_provider_config').insert({
    email_provider_id: providerId,
    tenant: tenantId,
    host: privateGateway,
    port: customImapPort,
    secure: false,
    allow_starttls: false,
    auth_type: 'password',
    username: mailboxUser,
    auto_process_emails: true,
    max_emails_per_sync: 20,
    folder_filters: JSON.stringify(['INBOX']),
    folder_state: {},
    uid_validity: null,
    last_uid: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });
  process.env[`TENANT_${tenantId}_imap_password_${providerId}`] = mailboxPassword;

  // The only reachable app-facing listener is an adapter which calls the real
  // route function. No Next or application server is started.
  const { POST } = await import('../../../../packages/integrations/src/webhooks/email/imap');
  adapter = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    try {
      const request = new Request(`http://127.0.0.1:${adapterPort}${req.url || '/'}`, {
        method: req.method,
        headers: req.headers as HeadersInit,
        body: Buffer.concat(chunks).length ? Buffer.concat(chunks) : undefined,
      });
      const response = await POST(request as any);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(await response.text());
    } catch (error) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message }));
    }
  });
  adapterPort = await listen(adapter);
  process.env.IMAP_WEBHOOK_URL = `http://127.0.0.1:${adapterPort}/api/email/webhooks/imap`;

  relay = net.createServer((socket) => {
    relaySockets.add(socket);
    socket.on('close', () => relaySockets.delete(socket));
    const upstream = net.connect(143, greenMailAddress);
    relaySockets.add(upstream);
    upstream.on('close', () => relaySockets.delete(upstream));
    socket.pipe(upstream);
    upstream.pipe(socket);
  });
  await listen(relay, customImapPort, privateGateway);
  imapFlowModule = await import('imapflow');
  await removeGreenMailMessage();

  const { assertSafeImapHost } = await import('@alga-psa/shared/services/email/imapOutboundTarget');
  await assert.rejects(() => assertSafeImapHost(privateGateway, customImapPort), /not allowed|private/i,
    'private custom-port target is denied with no deployment allowlist');
  service = new (await import('../../../../services/email-service/src/emailService')).EmailService();
  await service.start();
  await waitFor('listener default-deny status', async () => db('imap_email_provider_config')
    .where({ tenant: tenantId, email_provider_id: providerId }).first('last_error'),
  (row: any) => Boolean(row?.last_error));
  const deniedError = await db('imap_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).first('last_error');
  assert.match(String(deniedError?.last_error), /not allowed|private/i, 'listener records destination denial before connection');
  await service.stop();

  // This is the deployment operator's exact-target authorization. The worker
  // receives it through the same environment variable used by OAuth refresh.
  process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST = privateGateway;
  service = new (await import('../../../../services/email-service/src/emailService')).EmailService();
  await service.start();
  await waitFor('custom-port listener login', async () => db('email_providers').where({ tenant: tenantId, id: providerId }).first('status'),
    (row: any) => row?.status === 'connected');

  const deliveryClient = await createImapClient(privateGateway, customImapPort);
  const rawMime = Buffer.from([
    `From: Review Sender <sender-${suffix}@example.test>`,
    `To: ${mailbox}`,
    `Subject: ${subject}`,
    `Message-ID: <${messageId}>`,
    'Date: Thu, 20 Nov 2026 12:00:00 +0000',
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    bodyText,
    '',
  ].join('\r\n'));
  await deliveryClient.mailboxOpen('INBOX');
  const appendResult = await deliveryClient.append('INBOX', rawMime, { flags: [] });
  greenMailMessageUid = appendResult?.uid;
  await deliveryClient.logout();

  const { destroyAdminConnection, destroyTenantConnection } = await import('@alga-psa/db');
  const { EmailService } = await import('../../../../services/email-service/src/emailService');
  const { UnifiedInboundEmailQueueConsumerV2 } = await import('@alga-psa/shared/services/email/unifiedInboundEmailQueueConsumerV2');
  const { processUnifiedInboundEmailDurableJob, renewPostgresLeaseForV2Job } = await import('@alga-psa/shared/services/email/unifiedInboundEmailQueueJobProcessorV2');
  const { getInboundEmailDurableRedisClient } = await import('@alga-psa/shared/services/email/unifiedInboundEmailQueueV2');
  const consumer = new UnifiedInboundEmailQueueConsumerV2({
    consumerId: `imap-review-${suffix}`,
    pollDelayMs: 50,
    renewPostgresLease: renewPostgresLeaseForV2Job,
    handleJob: processUnifiedInboundEmailDurableJob,
  });
  const inboxRow = await waitFor('staged raw message and webhook pointer', async () => db('inbound_email_inbox')
    .where({ tenant: tenantId, provider_id: providerId, rfc_message_id: messageId })
    .first('inbox_id', 'status', 'source_object_key', 'source_sha256'),
  (row: any) => Boolean(row?.inbox_id && row?.source_object_key && row?.source_sha256));
  assert.equal(inboxRow.status, 'received');
  assert.match(inboxRow.source_object_key, new RegExp(`inbound-email/${tenantId}/${providerId}/`));

  let processed = false;
  for (let i = 0; i < 20; i += 1) {
    const latest = await db('inbound_email_inbox').where({ tenant: tenantId, inbox_id: inboxRow.inbox_id }).first('status');
    if (['succeeded', 'skipped', 'terminal_failed'].includes(latest?.status)) break;
    processed = (await consumer.runOnce()) || processed;
    if (!processed) await sleep(100);
  }
  assert.ok(processed, 'production durable consumer claimed an enqueued job');
  const terminalInbox = await waitFor('durable inbox terminal state', async () => db('inbound_email_inbox')
    .where({ tenant: tenantId, inbox_id: inboxRow.inbox_id }).first('status', 'outcome_kind', 'ticket_id'),
  (row: any) => ['succeeded', 'skipped', 'terminal_failed'].includes(row?.status));
  assert.equal(terminalInbox.status, 'succeeded', `message persisted with outcome ${terminalInbox.outcome_kind}`);
  assert.equal(terminalInbox.outcome_kind, 'created');

  const ticketId = terminalInbox.ticket_id;
  const persisted = await db('tickets').where({ tenant: tenantId, ticket_id: ticketId })
    .first('ticket_id', 'client_id', 'board_id', 'title', 'email_metadata');
  assert.ok(persisted, 'expected ticket row is persisted');
  assert.equal(persisted.client_id, client.client_id);
  assert.match(String(persisted.title), new RegExp(suffix));
  assert.equal(persisted.email_metadata.providerId, providerId, 'ticket retains provider association');
  assert.equal(persisted.email_metadata.messageId, messageId, 'ticket retains message identity');
  const providerAssociation = await db('email_providers').where({ tenant: tenantId, id: providerId }).first('tenant', 'id');
  assert.equal(providerAssociation.tenant, tenantId);
  assert.equal(providerAssociation.id, providerId);
  const ticketCountBeforeReplay = await db('tickets').where({ tenant: tenantId })
    .whereRaw("email_metadata->>'messageId' = ?", [messageId]).count('* as count').first();

  // Replay the production webhook pointer and restart the listener (which must
  // resume at its persisted UID cursor); neither may produce duplicate effects.
  const pointer = await db('inbound_email_ingress').where({ tenant: tenantId, provider_id: providerId, provider_type: 'imap' })
    .first('ingress_id', 'ingress_key', 'provider_pointer');
  assert.ok(pointer, 'webhook pointer persisted with tenant/provider association');
  const replay = await POST(new Request('http://local/api/email/webhooks/imap', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-imap-webhook-secret': webhookSecret },
    body: JSON.stringify({ providerId, tenant: tenantId, tenantId, pointer: { mailbox: 'INBOX', uid: pointer.provider_pointer.uid, uidValidity: pointer.provider_pointer.uidValidity, messageId } }),
  }) as any);
  assert.equal(replay.status, 200, 'same production webhook pointer is safely replayable');
  await consumer.runOnce();
  await service.stop();
  service = new EmailService();
  await service.start();
  await sleep(1800);
  await service.stop();

  const finalInboxCount = await db('inbound_email_inbox').where({ tenant: tenantId, provider_id: providerId, rfc_message_id: messageId }).count('* as count').first();
  const finalTickets = await db('tickets').where({ tenant: tenantId })
    .whereRaw("email_metadata->>'messageId' = ?", [messageId]).count('* as count').first();
  const finalIngressCount = await db('inbound_email_ingress').where({ tenant: tenantId, ingress_id: pointer.ingress_id }).count('* as count').first();
  assert.equal(Number(finalInboxCount?.count), 1, 'listener reconnect and webhook replay retain one inbox row');
  assert.equal(Number(finalTickets?.count), 1, 'listener reconnect and webhook replay retain one ticket');
  assert.equal(Number(finalIngressCount?.count), 1, 'webhook replay retains one ingress row');
  assert.ok(Number(ticketCountBeforeReplay?.count) <= 1);

  redisClient = await getInboundEmailDurableRedisClient();
  const queueKeys = [
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_READY_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_PROCESSING_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_HASH_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_INFLIGHT_LEASE_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DELAYED_DATA_KEY!,
    process.env.UNIFIED_INBOUND_EMAIL_QUEUE_V2_DLQ_KEY!,
  ];
  await redisClient.del(queueKeys);

  console.log(JSON.stringify({
    result: 'passed',
    productionComponents: ['services/email-service EmailService/ImapFolderListener', 'stageReadyInboundSource', 'packages/integrations POST', 'UnifiedInboundEmailQueueConsumerV2', 'processUnifiedInboundEmailDurableJob'],
    configuration: { allowlist: privateGateway, host: privateGateway, port: customImapPort, secure: false, postgres: `127.0.0.1:${postgresPort}`, redis: `127.0.0.1:${redisPort}`, storage: 'isolated local storage', database: 'unique seeded scratch database', queue: 'unique Redis key namespace' },
    defaultDeny: 'private custom-port target rejected with allowlist unset; listener persisted denial before connect',
    persisted: { tenant: tenantId.slice(0, 8), providerId: providerId.slice(0, 8), messageId, inboxCount: Number(finalInboxCount?.count), ingressCount: Number(finalIngressCount?.count), ticketCount: Number(finalTickets?.count), ticketId: String(ticketId).slice(0, 8), outcome: terminalInbox.outcome_kind, mimeSha256: inboxRow.source_sha256, storedMimeBytes: inboxRow.source_object_key ? Number((await fs.stat(path.join(scratchStorage, inboxRow.source_object_key))).size) : null },
    replayAndReconnect: 'same webhook pointer replayed, listener restarted; counts remained 1/1/1',
    applicationServerStarted: false,
  }, null, 2));

  await removeGreenMailMessage();
  greenMailMessageUid = undefined;
  await destroyAdminConnection();
  await destroyTenantConnection();
  await db.destroy();
  db = undefined;
  await dropDatabase();
  await fs.rm(scratchStorage, { recursive: true, force: true });
}

async function dropDatabase(): Promise<void> {
  if (!/^imap_private_ingest_[a-f0-9]{12}$/.test(dbName)) throw new Error('unsafe scratch database name');
  const { default: knex } = await import('knex');
  const admin = knex({
    client: 'pg',
    connection: {
      host: '127.0.0.1',
      port: postgresPort,
      user: 'postgres',
      password: process.env.DB_PASSWORD_ADMIN,
      database: 'postgres',
    },
  });
  try {
    await admin.raw('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = ? AND pid <> pg_backend_pid()', [dbName]);
    await admin.raw(`DROP DATABASE IF EXISTS "${dbName}"`);
  } finally {
    await admin.destroy();
  }
}

it('validates private custom-port IMAP ingestion through production components', async () => {
  try {
    await main();
  } finally {
    try { await service?.stop(); } catch { /* process cleanup */ }
    await closeServer(adapter);
    await removeGreenMailMessage();
    await closeServer(relay);
    try { await redisClient?.quit(); } catch { /* unique queue keys are isolated */ }
    if (db) {
      try { await db.destroy(); } catch { /* cleanup */ }
    }
    try {
      const { destroyAdminConnection, destroyTenantConnection } = await import('@alga-psa/db');
      await destroyAdminConnection();
      await destroyTenantConnection();
      await dropDatabase();
    } catch (error) {
      console.warn('scratch database cleanup failed:', (error as Error).message);
    }
    try { await fs.rm(scratchStorage, { recursive: true, force: true }); } catch { /* cleanup */ }
    delete process.env.EMAIL_PROVIDER_IMAP_PRIVATE_TARGET_ALLOWLIST;
    delete process.env.IMAP_WEBHOOK_SECRET;
    if (tenantId && providerId) delete process.env[`TENANT_${tenantId}_imap_password_${providerId}`];
  }
}, 300_000);
