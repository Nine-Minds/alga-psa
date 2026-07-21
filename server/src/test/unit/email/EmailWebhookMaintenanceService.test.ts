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
      andWhereRaw: vi.fn().mockReturnThis(),
      whereNull: vi.fn().mockReturnThis(),
      orWhere: vi.fn().mockReturnThis(),
      whereIn: vi.fn().mockReturnThis(),
      forUpdate: vi.fn().mockReturnThis(),
      first: vi.fn().mockImplementation((...columns: string[]) => {
        if (columns.includes('webhook_silent_runs')) {
          return Promise.resolve({
            last_webhook_delivery_at: provider.last_webhook_delivery_at || null,
            webhook_silent_runs: provider.webhook_silent_runs || 0,
          });
        }
        return Promise.resolve({
          last_sync_at: provider.last_sync_at,
          last_sync_cursor: provider.last_sync_at,
        });
      }),
      select: vi.fn()
        .mockResolvedValueOnce([provider])
        .mockResolvedValueOnce([]),
      update: vi.fn().mockImplementation(async (values: Record<string, unknown>) => {
        if (values.webhook_silent_runs === 'webhook_silent_runs + 1') {
          provider.webhook_silent_runs = Number(provider.webhook_silent_runs || 0) + 1;
        }
        return 1;
      }),
      insert: vi.fn().mockResolvedValue([1]),
    };
    const knex: any = vi.fn(() => query);
    knex.fn = { now: vi.fn(() => new Date()) };
    knex.raw = vi.fn((sql: string) => sql);
    knex.transaction = vi.fn(async (callback: (trx: any) => Promise<unknown>) => callback(knex));
    mocks.getAdminConnection.mockResolvedValue(knex);
    mocks.adapter.ensureTokenHealthy.mockResolvedValue(undefined);
    mocks.adapter.cleanupOrphanedSubscriptions.mockResolvedValue(1);
    mocks.adapter.listMessagesReceivedSince.mockResolvedValue([{
      id: 'missed-message',
      receivedDateTime: new Date().toISOString(),
    }]);
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

  it('falls back to healthy polling mode on endpoint validation failure', async () => {
    provider.delivery_mode = 'webhook';
    provider.webhook_subscription_id = null;
    provider.webhook_expires_at = null;
    mocks.adapter.initializeWebhook.mockResolvedValueOnce({
      success: false,
      errorKind: 'validation',
      error: 'Notification URL validation failed',
    });

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: provider.tenant,
      lookAheadMinutes: 60,
    });

    const knex = await mocks.getAdminConnection();
    const query = knex();
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      delivery_mode: 'polling',
      webhook_subscription_id: null,
      webhook_silent_runs: 0,
    }));
    expect(results[0]).toMatchObject({ success: true, action: 'skipped' });
  });

  it('restores webhook mode when a due polling recovery probe succeeds', async () => {
    provider.delivery_mode = 'polling';
    provider.next_subscription_probe_at = new Date(Date.now() - 1_000).toISOString();
    mocks.adapter.initializeWebhook.mockResolvedValueOnce({ success: true });
    mocks.adapter.getConfig.mockReturnValueOnce({
      webhook_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: provider.tenant,
    });

    const knex = await mocks.getAdminConnection();
    const query = knex();
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      delivery_mode: 'webhook',
      webhook_silent_runs: 0,
      next_subscription_probe_at: null,
    }));
    expect(results[0]).toMatchObject({ success: true, action: 'recreated' });
  });

  it('polling reconciliation imports missed messages without silence detection', async () => {
    provider.delivery_mode = 'polling';

    const results = await new EmailWebhookMaintenanceService().reconcilePollingProviders({
      tenantId: provider.tenant,
    });

    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(mocks.adapter.deleteWebhookSubscription).not.toHaveBeenCalled();
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

  it('does not enqueue or count a reconciliation window locked and committed by an overlapping run', async () => {
    provider.delivery_mode = 'webhook';
    provider.webhook_silent_runs = 2;
    const knex = await mocks.getAdminConnection();
    const query = knex();
    query.first
      .mockResolvedValueOnce({
        last_sync_at: provider.last_sync_at,
        last_sync_cursor: provider.last_sync_at,
      })
      .mockResolvedValueOnce({
        last_sync_cursor: new Date().toISOString(),
      });

    const results = await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: provider.tenant,
      lookAheadMinutes: 60,
    });

    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.adapter.deleteWebhookSubscription).not.toHaveBeenCalled();
    expect(provider.webhook_silent_runs).toBe(2);
    expect(query.forUpdate).toHaveBeenCalledOnce();
    expect(results[0]).toMatchObject({ success: true, action: 'skipped' });
  });

  it('does not commit the polling cursor when enqueue fails', async () => {
    provider.delivery_mode = 'polling';
    mocks.enqueue.mockRejectedValueOnce(new Error('Redis unavailable'));
    const knex = await mocks.getAdminConnection();
    const query = knex();

    const results = await new EmailWebhookMaintenanceService().reconcilePollingProviders({
      tenantId: provider.tenant,
    });

    expect(query.forUpdate).toHaveBeenCalledOnce();
    expect(query.update).not.toHaveBeenCalledWith(expect.objectContaining({
      last_sync_at: expect.any(String),
    }));
    expect(results[0]).toMatchObject({
      success: false,
      action: 'failed',
      error: 'Redis unavailable',
    });
  });

  it('does not count safety-margin retries as a second silent run', async () => {
    provider.delivery_mode = 'webhook';
    provider.webhook_silent_runs = 2;
    mocks.adapter.listMessagesReceivedSince.mockResolvedValueOnce([{
      id: 'retried-message',
      receivedDateTime: new Date(new Date(provider.last_sync_at).getTime() - 1_000).toISOString(),
    }]);

    await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: provider.tenant,
      lookAheadMinutes: 60,
    });

    expect(mocks.enqueue).toHaveBeenCalledOnce();
    expect(provider.webhook_silent_runs).toBe(2);
    expect(mocks.adapter.deleteWebhookSubscription).not.toHaveBeenCalled();
  });

  it('does not delete a webhook when its reset wins the polling-transition compare-and-set', async () => {
    provider.delivery_mode = 'webhook';
    provider.webhook_silent_runs = 2;
    const knex = await mocks.getAdminConnection();
    const query = knex();
    const defaultUpdate = query.update.getMockImplementation();
    query.update.mockImplementation(async (values: Record<string, unknown>) => {
      if (values.delivery_mode === 'polling') {
        provider.webhook_silent_runs = 0;
        provider.last_webhook_delivery_at = new Date().toISOString();
        return 0;
      }
      return defaultUpdate?.(values);
    });

    await new EmailWebhookMaintenanceService().renewMicrosoftWebhooks({
      tenantId: provider.tenant,
      lookAheadMinutes: 60,
    });

    expect(provider.webhook_silent_runs).toBe(0);
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({
      delivery_mode: 'polling',
      webhook_subscription_id: null,
    }));
    expect(mocks.adapter.deleteWebhookSubscription).not.toHaveBeenCalled();
  });
});
