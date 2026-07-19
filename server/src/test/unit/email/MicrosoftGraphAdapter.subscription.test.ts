import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { MicrosoftGraphAdapter } from '@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter';

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
});
