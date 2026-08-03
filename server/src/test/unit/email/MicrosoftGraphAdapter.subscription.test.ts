import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const requestUse = vi.fn();
  const client = {
    interceptors: { request: { use: requestUse } },
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  };
  return { client, requestUse };
});

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => mocks.client),
    post: vi.fn(),
  },
}));

vi.mock('@alga-psa/shared/db/admin', () => ({
  getAdminConnection: vi.fn(async () => {
    const query: any = {
      where: vi.fn().mockReturnThis(),
      update: vi.fn().mockResolvedValue(1),
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

describe('MicrosoftGraphAdapter subscription hygiene', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
