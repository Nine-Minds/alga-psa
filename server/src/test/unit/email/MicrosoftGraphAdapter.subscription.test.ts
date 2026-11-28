import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requestUse = vi.fn();
  const tokenPost = vi.fn();
  const dbUpdate = vi.fn().mockResolvedValue(1);
  const dbPluck = vi.fn();
  const client = {
    interceptors: { request: { use: requestUse }, response: { use: vi.fn() } },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { client, requestUse, tokenPost, dbUpdate, dbPluck };
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
      whereIn: vi.fn().mockReturnThis(),
      update: mocks.dbUpdate,
      pluck: mocks.dbPluck,
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
    vi.unstubAllEnvs();
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

  it('moves an existing subscription to the configured callback while renewing after a hostname change', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('NGROK_URL', 'https://stale-tunnel.ngrok.test');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', 'https://psa.new-customer.example');
    vi.stubEnv('APPLICATION_URL', 'http://alga-core.msp.svc.cluster.local:3000');

    const providerConfig = config();
    providerConfig.webhook_notification_url = 'https://psa.old-customer.example/api/email/webhooks/microsoft';
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await adapter.renewWebhookSubscription();

    expect(mocks.client.patch).toHaveBeenCalledWith(
      '/subscriptions/old-subscription',
      expect.objectContaining({
        expirationDateTime: expect.any(String),
        notificationUrl: 'https://psa.new-customer.example/api/email/webhooks/microsoft',
      }),
    );
    expect(providerConfig.webhook_notification_url)
      .toBe('https://psa.new-customer.example/api/email/webhooks/microsoft');
    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({
      webhook_expires_at: expect.any(String),
      last_subscription_renewal: expect.any(String),
    }));
    expect(mocks.dbUpdate.mock.calls[0][0]).not.toHaveProperty('webhook_notification_url');
  });

  it('renews expiration only when no public webhook override is configured', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('NGROK_URL', 'https://stale-tunnel.ngrok.test');
    vi.stubEnv('PUBLIC_WEBHOOK_BASE_URL', '');
    vi.stubEnv('APPLICATION_URL', 'http://alga-core.msp.svc.cluster.local:3000');
    vi.stubEnv('NEXT_PUBLIC_BASE_URL', '');
    vi.stubEnv('NEXTAUTH_URL', '');

    const providerConfig = config();
    providerConfig.webhook_notification_url = 'https://existing-hosted.example/api/email/webhooks/microsoft';
    const adapter = new MicrosoftGraphAdapter(providerConfig);

    await adapter.renewWebhookSubscription();

    expect(mocks.client.patch).toHaveBeenCalledTimes(1);
    expect(mocks.client.patch).toHaveBeenCalledWith(
      '/subscriptions/old-subscription',
      { expirationDateTime: expect.any(String) },
    );
    expect(providerConfig.webhook_notification_url)
      .toBe('https://existing-hosted.example/api/email/webhooks/microsoft');
    expect(mocks.dbUpdate).toHaveBeenCalledTimes(1);
    expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({
      webhook_expires_at: expect.any(String),
      last_subscription_renewal: expect.any(String),
    }));
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

  describe('cleanupOrphanedSubscriptions', () => {
    const webhookUrl = config().webhook_notification_url;
    const mailboxes = {
      sales: 'sales@example.test',
      'service-desk': 'service-desk@example.test',
    } as const;
    const resourceFor = (mailbox: string) =>
      `/users/${encodeURIComponent(mailbox)}/mailFolders/inbox/messages`;
    const future = () => new Date(Date.now() + 48 * 3600 * 1000).toISOString();
    const past = () => new Date(Date.now() - 3600 * 1000).toISOString();

    beforeEach(() => {
      mocks.dbPluck.mockReset();
      mocks.dbPluck.mockResolvedValue([]);
      mocks.client.get.mockReset();
    });

    it.each([
      ['sales', 'service-desk'],
      ['service-desk', 'sales'],
    ] as const)('never deletes a live sibling subscription (%s checked, %s sibling)', async (current, sibling) => {
      const row = (name: string) => ({
        id: `sub-${name}`,
        notificationUrl: webhookUrl,
        changeType: 'created',
        resource: `/users/${name}@example.test/mailFolders('inbox')/messages`,
      });
      mocks.client.get.mockResolvedValue({ data: { value: [row(current), row(sibling)] } });
      const adapter = new MicrosoftGraphAdapter({
        ...config(),
        mailbox: `${current}@example.test`,
        webhook_subscription_id: `sub-${current}`,
      });

      await adapter.cleanupOrphanedSubscriptions();

      expect(mocks.client.delete.mock.calls).toEqual([]);
    });

    it.each([
      ['sales', 'service-desk', 'set'],
      ['sales', 'service-desk', 'null'],
      ['sales', 'service-desk', 'undefined'],
      ['service-desk', 'sales', 'set'],
      ['service-desk', 'sales', 'null'],
      ['service-desk', 'sales', 'undefined'],
    ] as const)(
      'keeps live Graph-shaped subscriptions across repeated cleanup (%s checked, %s other, id %s)',
      async (checked, other, idState) => {
        const liveRow = (id: string, mailbox: string) => ({
          id,
          resource: resourceFor(mailbox),
          changeType: 'created',
          notificationUrl: webhookUrl,
          expirationDateTime: future(),
          clientState: 'secret',
        });
        mocks.client.get.mockResolvedValue({
          data: {
            value: [liveRow(`${checked}-live`, mailboxes[checked]), liveRow(`${other}-live`, mailboxes[other])],
          },
        });
        const provider: any = { ...config(), mailbox: mailboxes[checked] };
        if (idState === 'set') provider.webhook_subscription_id = `${checked}-live`;
        else if (idState === 'null') provider.webhook_subscription_id = null;
        else delete provider.webhook_subscription_id;
        const adapter = new MicrosoftGraphAdapter(provider);

        await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(0);
        await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(0);
        expect(mocks.client.delete).not.toHaveBeenCalled();
      },
    );

    it('keeps other subscriptions when mailboxes share the same webhook URL', async () => {
      const provider = { ...config(), mailbox: 'support@example.test' };
      const mailboxSubscription = {
        notificationUrl: provider.webhook_notification_url,
        changeType: 'created',
        resource: 'users/support%40example.test/mailFolders/inbox/messages',
        expirationDateTime: past(),
      };
      mocks.dbPluck.mockResolvedValue(['tracked-by-another-provider']);
      mocks.client.get.mockResolvedValue({
        data: {
          value: [
            { ...mailboxSubscription, id: 'old-subscription' },
            { ...mailboxSubscription, id: 'orphan' },
            { ...mailboxSubscription, id: 'live-untracked', expirationDateTime: future() },
            { ...mailboxSubscription, id: 'tracked-by-another-provider' },
            { ...mailboxSubscription, id: 'other-app-url', notificationUrl: 'https://other.example.test/webhook' },
            { ...mailboxSubscription, id: 'other-mailbox', resource: 'users/sales%40example.test/mailFolders/inbox/messages' },
          ],
        },
      });
      const adapter = new MicrosoftGraphAdapter(provider);

      await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(1);
      expect(mocks.client.delete).toHaveBeenCalledTimes(1);
      expect(mocks.client.delete).toHaveBeenCalledWith('/subscriptions/orphan');
    });

    it('deletes an owned, untracked, expired subscription exactly once', async () => {
      mocks.client.get.mockResolvedValue({
        data: {
          value: [{
            id: 'expired-orphan',
            notificationUrl: webhookUrl,
            changeType: 'created',
            resource: resourceFor('sales@example.test'),
            expirationDateTime: past(),
          }],
        },
      });
      const adapter = new MicrosoftGraphAdapter({ ...config(), mailbox: 'sales@example.test' });

      await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(1);
      expect(mocks.client.delete).toHaveBeenCalledTimes(1);
      expect(mocks.client.delete).toHaveBeenCalledWith('/subscriptions/expired-orphan');
    });

    it.each([
      ['missing', undefined],
      ['unparseable', 'not-a-date'],
    ])('does not delete a row with a %s expirationDateTime', async (_label, expirationDateTime) => {
      mocks.client.get.mockResolvedValue({
        data: {
          value: [{
            id: 'unproven',
            notificationUrl: webhookUrl,
            changeType: 'created',
            resource: resourceFor('sales@example.test'),
            expirationDateTime,
          }],
        },
      });
      const adapter = new MicrosoftGraphAdapter({ ...config(), mailbox: 'sales@example.test' });

      await expect(adapter.cleanupOrphanedSubscriptions()).resolves.toBe(0);
      expect(mocks.client.delete).not.toHaveBeenCalled();
    });
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
