import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adapter: {
    ensureTokenHealthy: vi.fn(),
    cleanupOrphanedSubscriptions: vi.fn(),
    listMessagesReceivedSince: vi.fn(),
    renewWebhookSubscription: vi.fn(),
    initializeWebhook: vi.fn(),
    deleteWebhookSubscription: vi.fn(),
    getConfig: vi.fn(),
  },
  enqueue: vi.fn(),
  getAdminConnection: vi.fn(),
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: vi.fn(() => mocks.adapter),
}));
vi.mock('@alga-psa/shared/services/email/microsoftEmailProviderConfig', () => ({
  buildMicrosoftEmailProviderConfig: vi.fn(async (config) => config),
}));
vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: mocks.enqueue,
}));
vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: mocks.getAdminConnection,
}));
vi.mock('@alga-psa/core/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { EmailWebhookMaintenanceService } from '@alga-psa/shared/services/email/EmailWebhookMaintenanceService';

describe('EmailWebhookMaintenanceService Microsoft recovery sweep', () => {
  let provider: any;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = {
      id: '11111111-1111-4111-8111-111111111111',
      tenant: '22222222-2222-4222-8222-222222222222',
      provider_name: 'Support',
      provider_type: 'microsoft',
      mailbox: 'support@example.test',
      is_active: true,
      status: 'error',
      last_sync_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      webhook_subscription_id: 'current-subscription',
      webhook_expires_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
      client_id: 'premise-app',
      client_secret: 'premise-secret',
      tenant_id: 'common',
      access_token: 'expired-access',
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() - 1000).toISOString(),
      folder_filters: ['Inbox'],
      max_emails_per_sync: 50,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const query = {
      join: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      andWhere: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation((...columns: string[]) => {
        if (columns.includes('last_webhook_delivery_at')) {
          return Promise.resolve({
            last_webhook_delivery_at: provider.last_webhook_delivery_at || null,
            webhook_silent_runs: provider.webhook_silent_runs || 0,
          });
        }
        return Promise.resolve({ last_sync_at: provider.last_sync_at });
      }),
      select: vi.fn()
        .mockResolvedValueOnce([provider])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
    };
    const knex: any = vi.fn(() => query);
    knex.fn = { now: vi.fn(() => new Date()) };
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.adapter.ensureTokenHealthy.mockResolvedValue(undefined);
    mocks.adapter.cleanupOrphanedSubscriptions.mockResolvedValue(1);
    mocks.adapter.listMessagesReceivedSince.mockResolvedValue([{ id: 'missed-message' }]);
    mocks.enqueue.mockResolvedValue({ queueDepth: 1 });
  });

  it('refreshes health, removes orphans, and enqueues missed messages even when renewal is not due', async () => {
    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: '22222222-2222-4222-8222-222222222222',
      lookAheadMinutes: 60,
    });

    expect(mocks.adapter.ensureTokenHealthy).toHaveBeenCalledWith(30);
    expect(mocks.adapter.cleanupOrphanedSubscriptions).toHaveBeenCalled();
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'microsoft',
      pointer: expect.objectContaining({ messageId: 'missed-message' }),
    }));
    expect(results[0]).toMatchObject({ success: true, action: 'skipped' });
  });

  it('reports refresh failures instead of continuing with a connected status', async () => {
    mocks.adapter.ensureTokenHealthy.mockRejectedValueOnce(new Error('invalid_grant'));

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: '22222222-2222-4222-8222-222222222222',
    });

    expect(mocks.adapter.cleanupOrphanedSubscriptions).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({
      success: false,
      action: 'failed',
      error: 'invalid_grant',
    });
  });

  it('does not renew, recreate, or reconcile polling providers before their probe is due', async () => {
    provider.delivery_mode = 'polling';
    provider.next_subscription_probe_at = new Date(Date.now() + 60 * 60 * 1000).toISOString();

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: '22222222-2222-4222-8222-222222222222',
      lookAheadMinutes: 60,
    });

    expect(mocks.adapter.cleanupOrphanedSubscriptions).not.toHaveBeenCalled();
    expect(mocks.adapter.listMessagesReceivedSince).not.toHaveBeenCalled();
    expect(mocks.adapter.renewWebhookSubscription).not.toHaveBeenCalled();
    expect(mocks.adapter.initializeWebhook).not.toHaveBeenCalled();
    expect(results[0]).toMatchObject({ success: true, action: 'skipped' });
  });

  it('culls a webhook after the third reconciliation run that imports missed mail', async () => {
    provider.delivery_mode = 'webhook';
    provider.webhook_silent_runs = 2;
    provider.last_webhook_delivery_at = null;

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: '22222222-2222-4222-8222-222222222222',
      lookAheadMinutes: 60,
    });

    expect(mocks.adapter.deleteWebhookSubscription).toHaveBeenCalledOnce();
    expect(results[0]).toMatchObject({ success: true, action: 'skipped' });
  });
});
