import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const withTransactionMock = vi.fn();
const tryConsumeMock = vi.fn();

const trxMock = vi.fn();
const trxRawMock = vi.fn((expression: string) => expression);
const providerQueryMock = {
  join: vi.fn(function join() {
    return this;
  }),
  where: vi.fn(function where() {
    return this;
  }),
  andWhere: vi.fn(function andWhere() {
    return this;
  }),
  whereNull: vi.fn(function whereNull() {
    return this;
  }),
  forUpdate: vi.fn(function forUpdate() {
    return this;
  }),
  first: vi.fn(),
};
// tenantDb(trx, tenant).table('tenants') → conn('tenants').where(tenant).first(...)
const tenantsQueryMock = {
  where: vi.fn(function where() {
    return this;
  }),
  first: vi.fn(async () => ({ product_code: 'psa' })),
};
const updateQueryMock = {
  where: vi.fn(function where() {
    return this;
  }),
  update: vi.fn().mockResolvedValue(1),
};

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/core/rateLimit', () => ({
  TokenBucketRateLimiter: { getInstance: () => ({ tryConsume: tryConsumeMock }) },
}));

// Keep the real tenantDb facade (the handler's tenant scoping runs against the
// mock trx below); only stub the transaction wrapper.
vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    withTransaction: (...args: any[]) => withTransactionMock(...args),
  };
});

describe('Microsoft unified inbound pointer queue ingress', () => {
  beforeEach(() => {
    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    getAdminConnectionMock.mockReset();
    withTransactionMock.mockReset();
    tryConsumeMock.mockReset();
    tryConsumeMock.mockResolvedValue({ allowed: true, remaining: 99 });
    trxMock.mockReset();
    trxRawMock.mockClear();
    providerQueryMock.join.mockClear();
    providerQueryMock.where.mockClear();
    providerQueryMock.andWhere.mockClear();
    providerQueryMock.whereNull.mockClear();
    providerQueryMock.forUpdate.mockClear();
    providerQueryMock.first.mockReset();

    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-ms-1' },
      queueDepth: 1,
    });

    providerQueryMock.first.mockResolvedValue({
      id: 'provider-ms-1',
      tenant: 'tenant-ms-1',
      mailbox: 'support@example.com',
      is_active: true,
      mc_webhook_verification_token: 'expected-client-state',
    });

    tenantsQueryMock.where.mockClear();
    tenantsQueryMock.first.mockClear();
    updateQueryMock.where.mockClear();
    updateQueryMock.update.mockClear();

    trxMock.mockImplementation((table: string) => {
      if (table === 'microsoft_email_provider_config as mc') {
        return providerQueryMock;
      }
      if (table === 'tenants') {
        return tenantsQueryMock;
      }
      if (table === 'microsoft_email_provider_config' || table === 'email_provider_health') {
        return updateQueryMock;
      }
      throw new Error(`Unexpected table in test transaction: ${table}`);
    });
    (trxMock as any).raw = trxRawMock;

    getAdminConnectionMock.mockResolvedValue({});
    withTransactionMock.mockImplementation(async (_conn: unknown, callback: (trx: any) => Promise<void>) => {
      await callback(trxMock);
    });
  });

  it('T001: Microsoft ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            changeType: 'created',
            clientState: 'expected-client-state',
            resource: '/users/user-1/messages/msg-123',
            resourceData: {
              '@odata.type': '#microsoft.graph.message',
              '@odata.id': 'msg-123',
              id: 'msg-123',
            },
            subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
            subscriptionId: 'sub-ms-1',
            tenantId: 'tenant-ms-1',
          },
        ],
      }),
    });

    const response = await handleMicrosoftWebhookPost(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      processedCount: 1,
      unifiedQueuedCount: 1,
      messageIds: ['msg-123'],
    });

    // Provider lookup stays tenant-scoped through the facade join.
    expect(providerQueryMock.join).toHaveBeenCalledWith('email_providers as ep', expect.any(Function));
    expect(providerQueryMock.forUpdate).toHaveBeenCalledWith('mc');

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    const enqueuePayload = enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0];
    expect(enqueuePayload).toMatchObject({
      tenantId: 'tenant-ms-1',
      providerId: 'provider-ms-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-ms-1',
        messageId: 'msg-123',
        resource: '/users/user-1/messages/msg-123',
        changeType: 'created',
      },
    });
    expect(enqueuePayload).not.toHaveProperty('emailData');
    expect(enqueuePayload).not.toHaveProperty('attachments');
    expect(enqueuePayload).not.toHaveProperty('rawMimeBase64');
    expect(updateQueryMock.update).toHaveBeenCalledWith(expect.objectContaining({
      last_webhook_delivery_at: expect.any(String),
      webhook_silent_runs: 0,
    }));
  });

  it('T004: Microsoft callback success waits for durable enqueue completion', async () => {
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );

    let resolveEnqueue!: (value: { job: { jobId: string }; queueDepth: number }) => void;
    const enqueueGate = new Promise<{ job: { jobId: string }; queueDepth: number }>((resolve) => {
      resolveEnqueue = resolve;
    });
    enqueueUnifiedInboundEmailQueueJobMock.mockImplementation(() => enqueueGate);

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            changeType: 'created',
            clientState: 'expected-client-state',
            resource: '/users/user-1/messages/msg-124',
            resourceData: {
              '@odata.type': '#microsoft.graph.message',
              '@odata.id': 'msg-124',
              id: 'msg-124',
            },
            subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
            subscriptionId: 'sub-ms-1',
            tenantId: 'tenant-ms-1',
          },
        ],
      }),
    });

    let settled = false;
    const responsePromise = handleMicrosoftWebhookPost(request).then((response) => {
      settled = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveEnqueue({ job: { jobId: 'job-ms-gated' }, queueDepth: 2 });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      processedCount: 1,
      unifiedQueuedCount: 1,
    });
  });

  it('T007: Microsoft unified ingress returns non-2xx when enqueue fails', async () => {
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );
    enqueueUnifiedInboundEmailQueueJobMock.mockRejectedValue(new Error('redis unavailable'));

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            changeType: 'created',
            clientState: 'expected-client-state',
            resource: '/users/user-1/messages/msg-125',
            resourceData: {
              '@odata.type': '#microsoft.graph.message',
              '@odata.id': 'msg-125',
              id: 'msg-125',
            },
            subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
            subscriptionId: 'sub-ms-1',
            tenantId: 'tenant-ms-1',
          },
        ],
      }),
    });

    const response = await handleMicrosoftWebhookPost(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Failed to enqueue one or more Microsoft pointer jobs',
      failureCount: 1,
    });
  });

  it('T027: Microsoft notifications with a wrong clientState are rejected fail-closed', async () => {
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            changeType: 'created',
            clientState: 'unexpected-client-state',
            resource: '/users/user-1/messages/msg-126',
            resourceData: {
              '@odata.type': '#microsoft.graph.message',
              '@odata.id': 'msg-126',
              id: 'msg-126',
            },
            subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
            subscriptionId: 'sub-ms-1',
            tenantId: 'tenant-ms-1',
          },
        ],
      }),
    });

    const response = await handleMicrosoftWebhookPost(request);
    expect(response.status).toBe(401);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('rejects a notification with no stored clientState and emits a security event', async () => {
    providerQueryMock.first.mockResolvedValueOnce({
      id: 'provider-ms-1', tenant: 'tenant-ms-1', mailbox: 'support@example.com', is_active: true,
      mc_webhook_verification_token: null,
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );
    try {
      const response = await handleMicrosoftWebhookPost(new NextRequest('http://localhost/api/email/webhooks/microsoft', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: [{ subscriptionId: 'sub-ms-1', clientState: 'forged', resource: '/messages/msg-1', resourceData: { id: 'msg-1' } }] }),
      }));
      expect(response.status).toBe(401);
      expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[MicrosoftWebhook] Rejected notification clientState validation',
        expect.objectContaining({ reason: 'missing_stored_client_state' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('returns 429 from an IP-keyed webhook rate bucket before processing notifications', async () => {
    tryConsumeMock.mockResolvedValueOnce({ allowed: false, remaining: 0, retryAfterMs: 1500 });
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );
    const response = await handleMicrosoftWebhookPost(new NextRequest('http://localhost/api/email/webhooks/microsoft', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
      body: JSON.stringify({ value: [] }),
    }));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(tryConsumeMock).toHaveBeenCalledWith('email-webhook-inbound', 'global', '203.0.113.7');
  });

  it.each([
    ['T003', 'inactive'],
    ['T004', 'paused'],
  ])('%s: Microsoft %s providers are acknowledged without enqueueing', async (_id, _state) => {
    providerQueryMock.first.mockResolvedValueOnce(null);
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );
    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [{
          changeType: 'created',
          clientState: 'expected-client-state',
          resource: '/users/user-1/messages/msg-gated',
          resourceData: { id: 'msg-gated' },
          subscriptionId: 'sub-ms-gated',
          tenantId: 'tenant-ms-1',
        }],
      }),
    });

    const response = await handleMicrosoftWebhookPost(request);

    expect(response.status).toBe(202);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
    expect(providerQueryMock.andWhere).toHaveBeenCalledWith('ep.is_active', true);
    expect(providerQueryMock.whereNull).toHaveBeenCalledWith('ep.inbound_paused_at');
  });

  it('logs a warning event for subscriptions with no provider record at all', async () => {
    providerQueryMock.first
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { handleMicrosoftWebhookPost } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/microsoftWebhookHandler'
    );
    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [{
          changeType: 'created',
          clientState: 'expected-client-state',
          resource: '/users/user-1/messages/msg-rogue',
          resourceData: { id: 'msg-rogue' },
          subscriptionId: 'sub-ms-rogue',
          tenantId: 'tenant-ms-1',
        }],
      }),
    });

    try {
      const response = await handleMicrosoftWebhookPost(request);

      expect(response.status).toBe(202);
      expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(
        '[MicrosoftWebhook] Ignoring notification for unknown subscription',
        expect.objectContaining({ event: 'microsoft_email_unknown_subscription' }),
      );
    } finally {
      warnSpy.mockRestore();
    }
  });
});
