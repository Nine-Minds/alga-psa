import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const getTenantSecretMock = vi.fn();
const verifyIdTokenMock = vi.fn();

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecret: vi.fn(async () => null),
  getSecretProviderInstance: async () => ({
    getTenantSecret: (...args: any[]) => getTenantSecretMock(...args),
  }),
}));

vi.mock('google-auth-library', () => ({
  OAuth2Client: class OAuth2Client {
    verifyIdToken(...args: any[]) {
      return verifyIdTokenMock(...args);
    }
  },
}));

function createJwt(email: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64');
  const payload = Buffer.from(
    JSON.stringify({
      aud: 'https://example.test/api/email/webhooks/google',
      iss: 'https://accounts.google.com',
      sub: 'pubsub-subject',
      email,
    })
  ).toString('base64');
  return `${header}.${payload}.signature`;
}

describe('Google unified inbound pointer queue ingress', () => {
  beforeEach(() => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_TENANT_IDS = '';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_PROVIDER_IDS = '';
    process.env.NEXTAUTH_URL = 'https://example.test';

    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    getAdminConnectionMock.mockReset();
    getTenantSecretMock.mockReset();
    verifyIdTokenMock.mockReset();

    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-g-1' },
      queueDepth: 1,
    });

    getTenantSecretMock.mockResolvedValue(
      JSON.stringify({ client_email: 'pubsub-service@example-project.iam.gserviceaccount.com' })
    );
    verifyIdTokenMock.mockResolvedValue({
      getPayload: async () => ({
        email: 'pubsub-service@example-project.iam.gserviceaccount.com',
        aud: 'https://example.test/api/email/webhooks/google',
        sub: 'pubsub-subject',
      }),
    });

    getAdminConnectionMock.mockImplementation(async () => {
      const knex = (table: string) => {
        const predicates: Array<{ column: string; value: unknown }> = [];
        const builder = {
          select() {
            return builder;
          },
          where(column: string, value: unknown) {
            predicates.push({ column, value });
            return builder;
          },
          andWhere(column: string, value: unknown) {
            predicates.push({ column, value });
            return builder;
          },
          async first() {
            if (table === 'google_email_provider_config') {
              const bySubscription = predicates.find((p) => p.column === 'pubsub_subscription_name');
              if (bySubscription) {
                return { email_provider_id: 'provider-g-1' };
              }
              const byProvider = predicates.find((p) => p.column === 'email_provider_id');
              if (byProvider) {
                return {
                  email_provider_id: 'provider-g-1',
                  tenant: 'tenant-g-1',
                  project_id: 'example-project',
                  pubsub_subscription_name: 'sub-google-1',
                  history_id: '17',
                };
              }
            }

            if (table === 'email_providers') {
              return {
                id: 'provider-g-1',
                tenant: 'tenant-g-1',
                mailbox: 'support@example.com',
                provider_type: 'google',
                is_active: true,
              };
            }

            throw new Error(`Unexpected table lookup in test: ${table}`);
          },
        };
        return builder;
      };
      return knex;
    });
  });

  it('T002: Google ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    const { handleGoogleWebhook } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/googleWebhookHandler'
    );

    const notification = {
      emailAddress: 'support@example.com',
      historyId: '42',
    };
    const pubsubPayload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-msg-1',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/example-project/subscriptions/sub-google-1',
    };

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${createJwt('pubsub-service@example-project.iam.gserviceaccount.com')}`,
      },
      body: JSON.stringify(pubsubPayload),
    });

    const response = await handleGoogleWebhook(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId: 'provider-g-1',
      tenant: 'tenant-g-1',
      historyId: '42',
    });

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    const enqueuePayload = enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0];
    expect(enqueuePayload).toMatchObject({
      tenantId: 'tenant-g-1',
      providerId: 'provider-g-1',
      provider: 'google',
      pointer: {
        historyId: '42',
        emailAddress: 'support@example.com',
        pubsubMessageId: 'pubsub-msg-1',
      },
    });
    expect(enqueuePayload).not.toHaveProperty('emailData');
    expect(enqueuePayload).not.toHaveProperty('attachments');
    expect(enqueuePayload).not.toHaveProperty('rawMimeBase64');
  });

  it('T005: Google callback success waits for durable enqueue completion', async () => {
    const { handleGoogleWebhook } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/googleWebhookHandler'
    );

    let resolveEnqueue!: (value: { job: { jobId: string }; queueDepth: number }) => void;
    const enqueueGate = new Promise<{ job: { jobId: string }; queueDepth: number }>((resolve) => {
      resolveEnqueue = resolve;
    });
    enqueueUnifiedInboundEmailQueueJobMock.mockImplementation(() => enqueueGate);

    const notification = {
      emailAddress: 'support@example.com',
      historyId: '43',
    };
    const pubsubPayload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-msg-2',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/example-project/subscriptions/sub-google-1',
    };

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${createJwt('pubsub-service@example-project.iam.gserviceaccount.com')}`,
      },
      body: JSON.stringify(pubsubPayload),
    });

    let settled = false;
    const responsePromise = handleGoogleWebhook(request).then((response) => {
      settled = true;
      return response;
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveEnqueue({ job: { jobId: 'job-g-gated' }, queueDepth: 2 });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      historyId: '43',
    });
  });

  it('T007: Google unified ingress returns non-2xx when enqueue fails', async () => {
    const { handleGoogleWebhook } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/googleWebhookHandler'
    );
    enqueueUnifiedInboundEmailQueueJobMock.mockRejectedValue(new Error('redis unavailable'));

    const notification = {
      emailAddress: 'support@example.com',
      historyId: '44',
    };
    const pubsubPayload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-msg-3',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/example-project/subscriptions/sub-google-1',
    };

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${createJwt('pubsub-service@example-project.iam.gserviceaccount.com')}`,
      },
      body: JSON.stringify(pubsubPayload),
    });

    const response = await handleGoogleWebhook(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Failed to enqueue Google pointer job',
    });
  });

  it('T028: Google JWT verification/auth remains enforced in enqueue-only mode', async () => {
    const { handleGoogleWebhook } = await import(
      '@alga-psa/integrations/webhooks/email/handlers/googleWebhookHandler'
    );

    const notification = {
      emailAddress: 'support@example.com',
      historyId: '45',
    };
    const pubsubPayload = {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: 'pubsub-msg-4',
        publishTime: new Date().toISOString(),
      },
      subscription: 'projects/example-project/subscriptions/sub-google-1',
    };

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/google', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(pubsubPayload),
    });

    const response = await handleGoogleWebhook(request);
    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Unauthorized - JWT token required',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });
});
