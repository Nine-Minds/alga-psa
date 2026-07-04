import { beforeEach, describe, expect, it, vi } from 'vitest';

import { lookupInboundWebhookBySlug } from '@/lib/inboundWebhooks/configLookup';

describe('inbound webhook config lookup', () => {
  const firstMock = vi.fn();
  const whereMock = vi.fn();
  let knex: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const builder = { where: whereMock, first: firstMock };
    whereMock.mockReturnValue(builder);
    knex = vi.fn().mockReturnValue(builder);
  });

  it('should look up the webhook scoped by tenant and slug', async () => {
    const row = {
      tenant: 'tenant-1',
      inbound_webhook_id: 'hook-1',
      name: 'RMM Alerts',
      slug: 'rmm-alerts',
      auth_type: 'hmac_sha256',
      auth_config: {},
      idempotency_source: null,
      idempotency_window_seconds: 600,
      handler_type: 'workflow',
      handler_config: {},
      sample_capture_expires_at: null,
      is_active: true,
      rate_limit_per_minute: 60,
    };
    firstMock.mockResolvedValue(row);

    const result = await lookupInboundWebhookBySlug(knex, 'tenant-1', 'rmm-alerts');

    expect(result).toBe(row);
    expect(knex).toHaveBeenCalledWith('inbound_webhooks');
    // Tenant scoping is mandatory: the slug alone must never identify a webhook.
    expect(whereMock).toHaveBeenCalledWith('inbound_webhooks.tenant', 'tenant-1');
    expect(whereMock).toHaveBeenCalledWith({ slug: 'rmm-alerts' });
    // The lookup selects the full config surface needed by the request processor.
    expect(firstMock).toHaveBeenCalledWith(expect.arrayContaining([
      'tenant',
      'inbound_webhook_id',
      'auth_type',
      'auth_config',
      'idempotency_source',
      'idempotency_window_seconds',
      'handler_type',
      'handler_config',
      'is_active',
      'rate_limit_per_minute',
    ]));
  });

  it('should return null when no webhook matches', async () => {
    firstMock.mockResolvedValue(undefined);

    const result = await lookupInboundWebhookBySlug(knex, 'tenant-1', 'missing');

    expect(result).toBeNull();
  });
});
