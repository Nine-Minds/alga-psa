import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getConnection = vi.fn();
const runWithTenant = vi.fn();
const resolveInboundWebhookTenantSlug = vi.fn();
const isInboundWebhooksEnabled = vi.fn();
const lookupInboundWebhookBySlug = vi.fn();
const getTenantSecret = vi.fn();
const checkInboundWebhookRateLimit = vi.fn();
const extractInboundWebhookIdempotencyKey = vi.fn();
const findDuplicateInboundDelivery = vi.fn();
const createInboundDelivery = vi.fn();
const updateInboundDeliveryOutcome = vi.fn();
const captureInboundWebhookSampleIfRequested = vi.fn();
const dispatchInboundWebhookHandler = vi.fn();

vi.mock('@/lib/db/db', () => ({
  getConnection: (...args: unknown[]) => getConnection(...args),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: (...args: unknown[]) => runWithTenant(...args),
}));

vi.mock('@/lib/inboundWebhooks/tenantResolver', () => ({
  resolveInboundWebhookTenantSlug: (...args: unknown[]) => resolveInboundWebhookTenantSlug(...args),
}));

vi.mock('@/lib/inboundWebhooks/featureFlag', () => ({
  isInboundWebhooksEnabled: (...args: unknown[]) => isInboundWebhooksEnabled(...args),
}));

vi.mock('@/lib/inboundWebhooks/configLookup', () => ({
  lookupInboundWebhookBySlug: (...args: unknown[]) => lookupInboundWebhookBySlug(...args),
}));

vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: vi.fn(async () => ({
    getTenantSecret: (...args: unknown[]) => getTenantSecret(...args),
  })),
}));

vi.mock('@/lib/inboundWebhooks/rateLimitConfig', () => ({
  checkInboundWebhookRateLimit: (...args: unknown[]) => checkInboundWebhookRateLimit(...args),
}));

vi.mock('@/lib/inboundWebhooks/idempotency', () => ({
  extractInboundWebhookIdempotencyKey: (...args: unknown[]) => extractInboundWebhookIdempotencyKey(...args),
  findDuplicateInboundDelivery: (...args: unknown[]) => findDuplicateInboundDelivery(...args),
}));

vi.mock('@/lib/inboundWebhooks/deliveryPersistence', () => ({
  createInboundDelivery: (...args: unknown[]) => createInboundDelivery(...args),
  updateInboundDeliveryOutcome: (...args: unknown[]) => updateInboundDeliveryOutcome(...args),
}));

vi.mock('@/lib/inboundWebhooks/sampleCapture', () => ({
  captureInboundWebhookSampleIfRequested: (...args: unknown[]) => captureInboundWebhookSampleIfRequested(...args),
}));

vi.mock('@/lib/inboundWebhooks/dispatcher', () => ({
  dispatchInboundWebhookHandler: (...args: unknown[]) => dispatchInboundWebhookHandler(...args),
}));

function hmacSignature(secret: string, body: string): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function activeHmacWebhook() {
  return {
    tenant: 'tenant-a',
    inbound_webhook_id: 'webhook-1',
    name: 'RMM Alerts',
    slug: 'rmm-alerts',
    auth_type: 'hmac_sha256',
    auth_config: {
      type: 'hmac_sha256',
      signature_header: 'X-Signature',
      secret_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_hmac_secret',
    },
    idempotency_source: null,
    idempotency_window_seconds: 86_400,
    handler_type: 'direct_action',
    handler_config: {
      type: 'direct_action',
      action: 'createTicket',
      field_mapping: {
        title: 'alert.message',
      },
    },
    sample_capture_expires_at: null,
    is_active: true,
    rate_limit_per_minute: 600,
  };
}

function activeBearerWebhook() {
  return {
    ...activeHmacWebhook(),
    auth_type: 'bearer',
    auth_config: {
      type: 'bearer',
      token_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_bearer_token',
    },
  };
}

function activeIpAllowlistWebhook() {
  return {
    ...activeHmacWebhook(),
    auth_type: 'ip_allowlist',
    auth_config: {
      type: 'ip_allowlist',
      ip_cidrs: ['203.0.113.0/24'],
    },
  };
}

function activePathTokenWebhook() {
  return {
    ...activeHmacWebhook(),
    auth_type: 'path_token',
    auth_config: {
      type: 'path_token',
      query_param: 'token',
      token_vault_path: 'inbound-webhooks/inbound_webhook_webhook-1_path_token',
    },
  };
}

describe('inbound webhook request processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveInboundWebhookTenantSlug.mockResolvedValue('tenant-a');
    isInboundWebhooksEnabled.mockResolvedValue(true);
    runWithTenant.mockImplementation((_tenant: string, callback: () => unknown) => callback());
    getConnection.mockResolvedValue({ fn: { now: vi.fn(() => new Date('2026-05-11T00:00:00.000Z')) } });
    lookupInboundWebhookBySlug.mockResolvedValue(activeHmacWebhook());
    getTenantSecret.mockResolvedValue('top-secret');
    checkInboundWebhookRateLimit.mockResolvedValue({ allowed: true });
    extractInboundWebhookIdempotencyKey.mockResolvedValue(null);
    findDuplicateInboundDelivery.mockResolvedValue(null);
    createInboundDelivery.mockResolvedValue({ deliveryId: 'delivery-1' });
    updateInboundDeliveryOutcome.mockResolvedValue(undefined);
    captureInboundWebhookSampleIfRequested.mockResolvedValue(undefined);
    dispatchInboundWebhookHandler.mockResolvedValue({ success: true, ticket_id: 'ticket-1' });
  });

  it('T030: accepts a valid HMAC request and returns 200 with delivery_id', async () => {
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest',
        'x-signature': `sha256=${hmacSignature('top-secret', body)}`,
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(response.status).toBe(200);
    expect(resolveInboundWebhookTenantSlug).toHaveBeenCalledWith('tenant-slug');
    expect(isInboundWebhooksEnabled).toHaveBeenCalledWith({ tenantId: 'tenant-a' });
    expect(runWithTenant).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(lookupInboundWebhookBySlug).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'rmm-alerts');
    expect(getTenantSecret).toHaveBeenCalledWith('tenant-a', 'inbound_webhook_webhook-1_hmac_secret');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/rmm-alerts',
        requestBody: { alert: { message: 'Disk full' } },
        authStatus: 'verified',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({ inbound_webhook_id: 'webhook-1' }),
        deliveryId: 'delivery-1',
        body: { alert: { message: 'Disk full' } },
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'dispatched',
        responseStatus: 200,
        responseBody: { delivery_id: 'delivery-1' },
      }),
    );
  });

  it('T031: rejects an invalid HMAC with 401 and logs only rejected-auth metadata', async () => {
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'user-agent': 'vitest',
        'x-signature': 'sha256=not-a-valid-signature',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/rmm-alerts',
        authStatus: 'rejected_signature',
        dispatchStatus: 'failed',
        responseStatus: 401,
        responseBody: null,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
    expect(updateInboundDeliveryOutcome).not.toHaveBeenCalled();
  });

  it('T032: rejects HMAC requests that use a mismatched signature header name', async () => {
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-wrong-signature': `sha256=${hmacSignature('top-secret', body)}`,
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        authStatus: 'rejected_signature',
        dispatchStatus: 'failed',
        responseStatus: 401,
      }),
    );
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T033: accepts a valid Bearer token request', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activeBearerWebhook());
    getTenantSecret.mockResolvedValue('bearer-secret');
    const body = JSON.stringify({ event: 'payment_received' });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/billing-events', {
      method: 'POST',
      headers: {
        authorization: 'Bearer bearer-secret',
        'content-type': 'application/json',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'billing-events',
    });

    await expect(response.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(response.status).toBe(200);
    expect(getTenantSecret).toHaveBeenCalledWith('tenant-a', 'inbound_webhook_webhook-1_bearer_token');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestPath: '/api/inbound/tenant-slug/billing-events',
        requestBody: { event: 'payment_received' },
        authStatus: 'verified',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        body: { event: 'payment_received' },
      }),
    );
  });

  it('T034: rejects a bad Bearer token with 401', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activeBearerWebhook());
    getTenantSecret.mockResolvedValue('bearer-secret');
    const body = JSON.stringify({ event: 'payment_received' });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/billing-events', {
      method: 'POST',
      headers: {
        authorization: 'Bearer wrong-token',
        'content-type': 'application/json',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'billing-events',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestPath: '/api/inbound/tenant-slug/billing-events',
        authStatus: 'rejected_bearer',
        dispatchStatus: 'failed',
        responseStatus: 401,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T035: accepts a request from an IP in the allowlist', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activeIpAllowlistWebhook());
    const body = JSON.stringify({ alert: { id: 'alert-1' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '203.0.113.42, 198.51.100.10',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(response.status).toBe(200);
    expect(getTenantSecret).not.toHaveBeenCalled();
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        sourceIp: '203.0.113.42',
        requestBody: { alert: { id: 'alert-1' } },
        authStatus: 'verified',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        body: { alert: { id: 'alert-1' } },
      }),
    );
  });

  it('T036: rejects a request from an IP outside the allowlist', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activeIpAllowlistWebhook());
    const body = JSON.stringify({ alert: { id: 'alert-1' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '198.51.100.42',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        sourceIp: '198.51.100.42',
        authStatus: 'rejected_ip',
        dispatchStatus: 'failed',
        responseStatus: 401,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T037: accepts a valid path-token request', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activePathTokenWebhook());
    getTenantSecret.mockResolvedValue('path-secret');
    const body = JSON.stringify({ source: 'automation' });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/custom-hook?token=path-secret', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'custom-hook',
    });

    await expect(response.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(response.status).toBe(200);
    expect(getTenantSecret).toHaveBeenCalledWith('tenant-a', 'inbound_webhook_webhook-1_path_token');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestPath: '/api/inbound/tenant-slug/custom-hook?token=path-secret',
        requestBody: { source: 'automation' },
        authStatus: 'verified',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        body: { source: 'automation' },
      }),
    );
  });

  it('T038: rejects an invalid path-token request with 401', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(activePathTokenWebhook());
    getTenantSecret.mockResolvedValue('path-secret');
    const body = JSON.stringify({ source: 'automation' });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/custom-hook?token=wrong-secret', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'custom-hook',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(getTenantSecret).toHaveBeenCalledWith('tenant-a', 'inbound_webhook_webhook-1_path_token');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestPath: '/api/inbound/tenant-slug/custom-hook?token=wrong-secret',
        authStatus: 'rejected_no_auth',
        dispatchStatus: 'failed',
        responseStatus: 401,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });
});
