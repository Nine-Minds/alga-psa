import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requestUse = vi.fn();
  const tokenPost = vi.fn();
  const dbUpdate = vi.fn().mockResolvedValue(1);
  const client = {
    interceptors: { request: { use: requestUse } },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { client, requestUse, tokenPost, dbUpdate };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.client),
    post: mocks.tokenPost,
  },
}));

vi.mock('@alga-psa/shared/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    const query: any = {
      where: vi.fn().mockReturnThis(),
      update: mocks.dbUpdate,
    };
    return vi.fn(() => query);
  }),
}));

import {
  MicrosoftGraphAdapter,
  MicrosoftSubscriptionError,
} from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';

function config() {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    tenant: '22222222-2222-4222-8222-222222222222',
    name: 'Support',
    provider_type: 'microsoft' as const,
    mailbox: '',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: 'https://example.test/api/email/webhooks/microsoft',
    webhook_subscription_id: 'old-subscription',
    webhook_verification_token: 'client-state',
    connection_status: 'connected' as const,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_config: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  };
}

function jwt(claims: Record<string, unknown>): string {
  return `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
}

describe('MicrosoftGraphAdapter subscription hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.dbUpdate.mockResolvedValue(1);
    mocks.client.delete.mockResolvedValue({ status: 204 });
    mocks.client.post.mockResolvedValue({
      data: { id: 'new-subscription', expirationDateTime: new Date(Date.now() + 3600000).toISOString() },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps creation and renewal expirations within the Graph 4230-minute cap', async () => {
    vi.useFakeTimers();
    const now = new Date('2026-08-03T12:00:00.000Z');
    vi.setSystemTime(now);
    const adapter = new MicrosoftGraphAdapter(config());

    await adapter.registerWebhookSubscription();
    await adapter.renewWebhookSubscription();

    const createdSubscription = mocks.client.post.mock.calls[0][1];
    const renewedSubscription = mocks.client.patch.mock.calls[0][1];
    const creationLifetimeMs = Date.parse(createdSubscription.expirationDateTime) - now.getTime();
    const renewalLifetimeMs = Date.parse(renewedSubscription.expirationDateTime) - now.getTime();
    const graphMaximumLifetimeMs = 4_230 * 60 * 1000;

    expect(creationLifetimeMs).toBeLessThanOrEqual(graphMaximumLifetimeMs);
    expect(renewalLifetimeMs).toBeLessThanOrEqual(graphMaximumLifetimeMs);
    expect(renewalLifetimeMs).toBe(creationLifetimeMs);
  });

  it('best-effort deletes the previous subscription before creating its replacement', async () => {
    const adapter = new MicrosoftGraphAdapter(config());
    await adapter.registerWebhookSubscription();

    expect(mocks.client.delete).toHaveBeenCalledWith('/subscriptions/old-subscription');
    expect(mocks.client.delete.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.post.mock.invocationCallOrder[0]
    );
  });

  it('generates and persists a strong clientState before creating a subscription when absent', async () => {
    const providerConfig = config();
    delete (providerConfig as any).webhook_verification_token;
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await adapter.registerWebhookSubscription();

    const createdSubscription = mocks.client.post.mock.calls[0][1];
    expect(createdSubscription.clientState).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.dbUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.post.mock.invocationCallOrder[0],
    );
  });

  it('deletes only same-notification-url subscriptions that are not the DB cursor', async () => {
    mocks.client.get.mockResolvedValue({
      data: {
        value: [
          { id: 'old-subscription', notificationUrl: config().webhook_notification_url },
          { id: 'orphan', notificationUrl: config().webhook_notification_url },
          { id: 'other-app-url', notificationUrl: 'https://other.example.test/webhook' },
        ],
      },
    });
    const adapter = new MicrosoftGraphAdapter(config());

    await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(1);
    expect(mocks.client.delete).toHaveBeenCalledTimes(1);
    expect(mocks.client.delete).toHaveBeenCalledWith('/subscriptions/orphan');
  });

  it('T017: deletes the explicitly supplied stored Graph subscription', async () => {
    const adapter = new MicrosoftGraphAdapter(config());

    await adapter.deleteSubscription('stored/subscription');

    expect(mocks.client.delete).toHaveBeenCalledWith('/subscriptions/stored%2Fsubscription');
  });

  it('T018: treats an already-gone Graph subscription as successful cleanup', async () => {
    mocks.client.delete.mockRejectedValueOnce({ response: { status: 404 } });

    await expect(new MicrosoftGraphAdapter(config()).deleteSubscription()).resolves.toBeUndefined();
  });

  it('classifies endpoint validation failures separately from authentication failures', async () => {
    mocks.client.post.mockRejectedValueOnce({
      message: 'Request failed with status code 400',
      response: {
        status: 400,
        data: { error: { code: 'ValidationError', message: 'Notification URL validation failed' } },
        headers: {},
      },
    });

    await expect(new MicrosoftGraphAdapter(config()).registerWebhookSubscription())
      .rejects.toMatchObject<Partial<MicrosoftSubscriptionError>>({ kind: 'validation', status: 400 });

    mocks.client.post.mockRejectedValueOnce({
      message: 'Request failed with status code 403',
      response: {
        status: 403,
        data: { error: { code: 'ErrorAccessDenied', message: 'Access denied' } },
        headers: {},
      },
    });

    await expect(new MicrosoftGraphAdapter(config()).registerWebhookSubscription())
      .rejects.toMatchObject<Partial<MicrosoftSubscriptionError>>({ kind: 'authentication', status: 403 });
  });

  it('propagates a subscription-id persistence failure instead of swallowing it (the callback can then compensate)', async () => {
    const dbError = new Error('injected: UPDATE microsoft_email_provider_config failed');
    mocks.dbUpdate.mockRejectedValue(dbError);

    // The failure must leave registerWebhookSubscription as a
    // MicrosoftSubscriptionError classified 'other' (never 'validation', which
    // the callback would downgrade to a polling fallback), and must keep the
    // original DB error in its cause chain for diagnostics/compensation.
    await expect(new MicrosoftGraphAdapter(config()).registerWebhookSubscription())
      .rejects.toMatchObject<Partial<MicrosoftSubscriptionError>>({ kind: 'other' });
    await expect(new MicrosoftGraphAdapter(config()).registerWebhookSubscription())
      .rejects.toSatisfy((err: any) => err?.cause?.message === dbError.message);
  });
});

describe('MicrosoftGraphAdapter token refresh authority', () => {
  const previousDeploymentProfile = process.env.DEPLOYMENT_PROFILE;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DEPLOYMENT_PROFILE;
    mocks.tokenPost.mockRejectedValue({
      message: 'Request failed with status code 400',
      response: { status: 400, data: { error: 'invalid_grant' }, headers: {} },
    });
  });

  afterEach(() => {
    if (previousDeploymentProfile === undefined) {
      delete process.env.DEPLOYMENT_PROFILE;
    } else {
      process.env.DEPLOYMENT_PROFILE = previousDeploymentProfile;
    }
  });

  it('refreshes a hosted provider through the shared multi-tenant authority', async () => {
    const providerConfig = config();
    providerConfig.provider_config = {
      ...providerConfig.provider_config,
      client_id: 'platform-client',
      client_secret: 'platform-secret',
      tenant_id: 'platform-home-tenant',
      access_token: jwt({ tid: 'customer-token-tenant' }),
      token_expires_at: new Date(0).toISOString(),
    };
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await expect(adapter.ensureTokenHealthy()).rejects.toThrow('refreshAccessToken');

    expect(mocks.tokenPost).toHaveBeenCalledOnce();
    expect(mocks.tokenPost.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/common/oauth2/v2.0/token'
    );
    const params = new URLSearchParams(mocks.tokenPost.mock.calls[0][1]);
    expect(params.get('grant_type')).toBe('refresh_token');
    expect(params.has('scope')).toBe(false);
  });

  it('uses the configured tenant authority for an appliance provider', async () => {
    process.env.DEPLOYMENT_PROFILE = 'appliance';
    const providerConfig = config();
    providerConfig.provider_config = {
      ...providerConfig.provider_config,
      client_id: 'single-tenant-client',
      client_secret: 'single-tenant-secret',
      tenant_id: 'configured-tenant',
      access_token: 'opaque-access-token',
      token_expires_at: new Date(0).toISOString(),
    };
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await expect(adapter.ensureTokenHealthy()).rejects.toThrow('refreshAccessToken');

    expect(mocks.tokenPost.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/configured-tenant/oauth2/v2.0/token'
    );
  });

  it('falls back to the token tenant for an appliance provider without a configured tenant', async () => {
    process.env.DEPLOYMENT_PROFILE = 'appliance';
    const providerConfig = config();
    providerConfig.provider_config = {
      ...providerConfig.provider_config,
      client_id: 'single-tenant-client',
      client_secret: 'single-tenant-secret',
      access_token: jwt({ tid: 'customer-token-tenant' }),
      token_expires_at: new Date(0).toISOString(),
    };
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await expect(adapter.ensureTokenHealthy()).rejects.toThrow('refreshAccessToken');

    expect(mocks.tokenPost.mock.calls[0][0]).toBe(
      'https://login.microsoftonline.com/customer-token-tenant/oauth2/v2.0/token'
    );
  });
});
