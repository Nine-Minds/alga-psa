import { beforeAll, afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import type { Knex } from 'knex';
import { v4 as uuidv4 } from 'uuid';
import { NextRequest } from 'next/server';
import { createTestDbConnection } from '../../../test-utils/dbConfig';
import { describeWithDb } from '../../../test-utils/requireDb';

const describeDb = await describeWithDb();

let db: Knex;
let tenantId: string;
let clientId: string;
let boardId: string;
let statusId: string;
let priorityId: string;
let enteredByUserId: string;

const publishEventMock = vi.fn();
const processInboundEmailInAppMock = vi.fn();
const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getAppSecret: async () => '',
    getTenantSecret: async () => null,
  })),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    if (!db) throw new Error('Test DB not initialized');
    return db;
  }),
  destroyAdminConnection: vi.fn(async () => {}),
}));

vi.mock('@alga-psa/shared/events/publisher', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/processInboundEmailInApp', () => ({
  processInboundEmailInApp: (...args: any[]) => processInboundEmailInAppMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) =>
    enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('google-auth-library', () => {
  class OAuth2Client {
    async verifyIdToken(_opts: any) {
      return {
        getPayload: () => ({
          email: 'pubsub-publishing@system.gserviceaccount.com',
          aud: _opts?.audience,
          sub: 'sub',
        }),
      };
    }
  }
  return { OAuth2Client };
});

function makeFakeJwt(payload: Record<string, any>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

async function setupProvider(params: { providerId: string; mailbox: string; subscriptionName: string }) {
  const defaultsId = uuidv4();
  await db('inbound_ticket_defaults').insert({
    id: defaultsId,
    tenant: tenantId,
    short_name: `email-${defaultsId.slice(0, 6)}`,
    display_name: `Email Defaults ${defaultsId.slice(0, 6)}`,
    description: 'Test defaults',
    board_id: boardId,
    status_id: statusId,
    priority_id: priorityId,
    client_id: clientId,
    entered_by: enteredByUserId,
    is_active: true,
    is_default: false,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('email_providers').insert({
    id: params.providerId,
    tenant: tenantId,
    provider_type: 'google',
    provider_name: 'Test Gmail Provider',
    mailbox: params.mailbox,
    is_active: true,
    status: 'connected',
    inbound_ticket_defaults_id: defaultsId,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  await db('google_email_provider_config').insert({
    email_provider_id: params.providerId,
    tenant: tenantId,
    client_id: 'client-id',
    client_secret: 'secret',
    project_id: 'project-id',
    redirect_uri: 'http://localhost/callback',
    pubsub_topic_name: 'topic',
    pubsub_subscription_name: params.subscriptionName,
    auto_process_emails: true,
    max_emails_per_sync: 50,
    label_filters: JSON.stringify([]),
    access_token: 'access',
    refresh_token: 'refresh',
    token_expires_at: null,
    history_id: '1',
    watch_expiration: null,
    created_at: db.fn.now(),
    updated_at: db.fn.now(),
  });

  return { defaultsId };
}

function makeWebhookRequest(params: {
  mailbox: string;
  historyId: string;
  pubsubMessageId: string;
  subscriptionName: string;
  token: string;
}): NextRequest {
  const notification = { emailAddress: params.mailbox, historyId: params.historyId };
  return new NextRequest('http://localhost:3000/api/email/webhooks/google', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${params.token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: params.pubsubMessageId,
        publishTime: new Date().toISOString(),
      },
      subscription: `projects/project/subscriptions/${params.subscriptionName}`,
    }),
  });
}

describeDb('Inbound email in-app processing feature flag (integration)', () => {
  const cleanup: Array<() => Promise<void>> = [];

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3000';
    db = await createTestDbConnection();

    const tenant = await db('tenants').first<{ tenant: string }>('tenant');
    if (!tenant?.tenant) throw new Error('Expected seeded tenant');
    tenantId = tenant.tenant;

    const client = await db('clients').where({ tenant: tenantId }).first<{ client_id: string }>('client_id');
    if (!client?.client_id) throw new Error('Expected seeded client');
    clientId = client.client_id;

    const board = await db('boards').where({ tenant: tenantId }).first<{ board_id: string }>('board_id');
    if (!board?.board_id) throw new Error('Expected seeded board');
    boardId = board.board_id;

    const status = await db('statuses')
      .where({ tenant: tenantId, status_type: 'ticket' })
      .first<{ status_id: string }>('status_id');
    if (!status?.status_id) throw new Error('Expected seeded ticket status');
    statusId = status.status_id;

    const priority = await db('priorities').where({ tenant: tenantId }).first<{ priority_id: string }>('priority_id');
    if (!priority?.priority_id) throw new Error('Expected seeded priority');
    priorityId = priority.priority_id;

    const user = await db('users').where({ tenant: tenantId }).first<{ user_id: string }>('user_id');
    if (!user?.user_id) throw new Error('Expected seeded user');
    enteredByUserId = user.user_id;
  }, 180_000);

  afterEach(async () => {
    while (cleanup.length) {
      const fn = cleanup.pop();
      if (fn) await fn();
    }
    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = '';
    process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = '';
    publishEventMock.mockClear();
    processInboundEmailInAppMock.mockClear();
    enqueueUnifiedInboundEmailQueueJobMock.mockClear();
  });

  afterAll(async () => {
    if (db) await db.destroy();
  });

  // The in-app processing feature flag was removed (the email-service path is
  // enforced unconditionally): the legacy flag env vars must no longer change
  // behavior — the webhook always hands off to the unified pointer queue and
  // never publishes legacy events or processes inline.
  it('Feature flag removal: webhook always enqueues to the unified queue regardless of legacy flag values', async () => {
    const providerId = uuidv4();
    const mailbox = `support-flag-${uuidv4().slice(0, 6)}@example.com`;
    const subscriptionName = `sub-${uuidv4().slice(0, 6)}`;
    const { defaultsId } = await setupProvider({ providerId, mailbox, subscriptionName });

    cleanup.push(async () => {
      await db('google_email_provider_config').where({ tenant: tenantId, email_provider_id: providerId }).delete();
      await db('email_providers').where({ tenant: tenantId, id: providerId }).delete();
      await db('inbound_ticket_defaults').where({ tenant: tenantId, id: defaultsId }).delete();
    });

    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-flag-1' },
      queueDepth: 1,
    });

    const token = makeFakeJwt({
      aud: 'http://localhost:3000/api/email/webhooks/google',
      iss: 'issuer',
      sub: 'subject',
      email: 'pubsub-publishing@system.gserviceaccount.com',
    });

    const { POST } = await import('@alga-psa/integrations/webhooks/email/google');

    // Legacy flags unset => unified queue handoff.
    const res1 = await POST(
      makeWebhookRequest({
        mailbox,
        historyId: '100',
        pubsubMessageId: 'pubsub-msg-1',
        subscriptionName,
        token,
      })
    );
    expect(res1.status).toBe(200);
    expect(await res1.json()).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId,
      tenant: tenantId,
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0]).toMatchObject({
      tenantId,
      providerId,
      provider: 'google',
      pointer: { historyId: '100', emailAddress: mailbox },
    });
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();

    enqueueUnifiedInboundEmailQueueJobMock.mockClear();

    // Legacy flags set => identical unified-queue behavior (flags are dead).
    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = providerId;
    process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'true';
    const res2 = await POST(
      makeWebhookRequest({
        mailbox,
        historyId: '101',
        pubsubMessageId: 'pubsub-msg-2',
        subscriptionName,
        token,
      })
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId,
      tenant: tenantId,
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0]).toMatchObject({
      tenantId,
      providerId,
      provider: 'google',
      pointer: { historyId: '101', emailAddress: mailbox },
    });
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();
  });
});
