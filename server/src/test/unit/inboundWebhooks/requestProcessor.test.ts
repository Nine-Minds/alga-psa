import crypto from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getConnection = vi.fn();
const runWithTenant = vi.fn();
const resolveInboundWebhookTenantSlug = vi.fn();
const lookupInboundWebhookBySlug = vi.fn();
const getTenantSecret = vi.fn();
const checkInboundWebhookRateLimit = vi.fn();
const extractInboundWebhookIdempotencyKey = vi.fn();
const findDuplicateInboundDelivery = vi.fn();
const createInboundDelivery = vi.fn();
const updateInboundDeliveryOutcome = vi.fn();
const captureInboundWebhookSampleIfRequested = vi.fn();
const dispatchInboundWebhookHandler = vi.fn();

class TestInboundWebhookMappingError extends Error {
  public readonly statusCode = 400;
  public readonly code = 'mapping_failed';

  constructor(message: string) {
    super(message);
    this.name = 'InboundWebhookMappingError';
  }
}

class TestInboundWebhookActionError extends Error {
  public readonly action: string;
  public readonly entityType?: string;
  public readonly externalId?: string;
  public readonly metadata?: Record<string, unknown>;

  constructor(args: {
    action: string;
    message: string;
    entityType?: string;
    externalId?: string;
    metadata?: Record<string, unknown>;
  }) {
    super(args.message);
    this.name = 'InboundWebhookActionError';
    this.action = args.action;
    this.entityType = args.entityType;
    this.externalId = args.externalId;
    this.metadata = args.metadata;
  }

  toOutcome(): Record<string, unknown> {
    return {
      action: this.action,
      error: this.message,
      entity_type: this.entityType,
      external_id: this.externalId,
      metadata: this.metadata,
    };
  }
}

vi.mock('@/lib/db/db', () => ({
  getConnection: (...args: unknown[]) => getConnection(...args),
}));

vi.mock('@/lib/db', () => ({
  runWithTenant: (...args: unknown[]) => runWithTenant(...args),
}));

vi.mock('@/lib/inboundWebhooks/tenantResolver', () => ({
  resolveInboundWebhookTenantSlug: (...args: unknown[]) => resolveInboundWebhookTenantSlug(...args),
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
  InboundWebhookMappingError: TestInboundWebhookMappingError,
  InboundWebhookActionError: TestInboundWebhookActionError,
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

function inactiveHmacWebhook() {
  return {
    ...activeHmacWebhook(),
    is_active: false,
  };
}

function hmacWebhookWithHeaderIdempotency() {
  return {
    ...activeHmacWebhook(),
    idempotency_source: {
      type: 'header',
      value: 'X-Idempotency-Key',
    },
  };
}

describe('inbound webhook request processor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveInboundWebhookTenantSlug.mockResolvedValue('tenant-a');
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

  it('T182: resolves the tenant before running the inbound webhook pipeline', async () => {
    resolveInboundWebhookTenantSlug.mockImplementation(async (tenantSlug: string) =>
      tenantSlug === 'tenant-b-slug' ? 'tenant-b' : 'tenant-a',
    );

    const enabledBody = JSON.stringify({ alert: { message: 'Tenant A alert' } });
    const enabledRequest = new NextRequest('http://localhost/api/inbound/tenant-a-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${hmacSignature('top-secret', enabledBody)}`,
      },
      body: enabledBody,
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const enabledResponse = await processInboundWebhookRequest({
      request: enabledRequest,
      tenantSlug: 'tenant-a-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(enabledResponse.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(enabledResponse.status).toBe(200);
    expect(runWithTenant).toHaveBeenCalledWith('tenant-a', expect.any(Function));

    runWithTenant.mockClear();
    lookupInboundWebhookBySlug.mockClear();
    createInboundDelivery.mockClear();
    dispatchInboundWebhookHandler.mockClear();

    const tenantBRequest = new NextRequest('http://localhost/api/inbound/tenant-b-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': `sha256=${hmacSignature('top-secret', JSON.stringify({ alert: { message: 'Tenant B alert' } }))}`,
      },
      body: JSON.stringify({ alert: { message: 'Tenant B alert' } }),
    });

    const tenantBResponse = await processInboundWebhookRequest({
      request: tenantBRequest,
      tenantSlug: 'tenant-b-slug',
      webhookSlug: 'rmm-alerts',
    });

    await expect(tenantBResponse.json()).resolves.toEqual({ delivery_id: 'delivery-1' });
    expect(tenantBResponse.status).toBe(200);
    expect(runWithTenant).toHaveBeenCalledWith('tenant-b', expect.any(Function));
    expect(lookupInboundWebhookBySlug).toHaveBeenCalledWith(expect.anything(), 'tenant-b', 'rmm-alerts');
  });

  it('T1012: records created ticket id in the delivery handler outcome', async () => {
    dispatchInboundWebhookHandler.mockResolvedValue({
      action: 'createTicket',
      entity_type: 'ticket',
      entity_id: 'ticket-1',
      metadata: {
        ticket_number: 'T-100',
      },
    });
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    expect(response.status).toBe(200);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'dispatched',
        handlerOutcome: {
          action: 'createTicket',
          entity_type: 'ticket',
          entity_id: 'ticket-1',
          metadata: {
            ticket_number: 'T-100',
          },
        },
      }),
    );
  });

  it('T200: signed HMAC createTicket webhook stores the created ticket outcome for the UI log', async () => {
    dispatchInboundWebhookHandler.mockResolvedValue({
      action: 'createTicket',
      entity_type: 'ticket',
      entity_id: 'ticket-acceptance-1',
      metadata: {
        ticket_number: 'T-ACCEPT-1',
        title: 'Critical disk alert',
      },
    });
    const body = JSON.stringify({
      alert: {
        id: 'rmm-alert-200',
        message: 'Critical disk alert',
        severity: 'critical',
      },
    });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'rmm-alert-200',
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
    expect(lookupInboundWebhookBySlug).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'rmm-alerts');
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        webhook: expect.objectContaining({
          handler_type: 'direct_action',
          handler_config: expect.objectContaining({
            action: 'createTicket',
          }),
        }),
        body: {
          alert: {
            id: 'rmm-alert-200',
            message: 'Critical disk alert',
            severity: 'critical',
          },
        },
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'dispatched',
        handlerOutcome: {
          action: 'createTicket',
          entity_type: 'ticket',
          entity_id: 'ticket-acceptance-1',
          metadata: {
            ticket_number: 'T-ACCEPT-1',
            title: 'Critical disk alert',
          },
        },
        responseStatus: 200,
        responseBody: { delivery_id: 'delivery-1' },
      }),
    );
  });

  it('T113: records workflow_run_id in the delivery handler outcome after workflow trigger', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue({
      ...activeHmacWebhook(),
      handler_type: 'workflow',
      handler_config: {
        type: 'workflow',
        workflow_id: 'workflow-1',
      },
    });
    dispatchInboundWebhookHandler.mockResolvedValue({
      workflow_id: 'workflow-1',
      workflow_run_id: 'workflow-run-1',
      workflow_version: 3,
      envelope: {
        source: 'rmm-alerts',
        body: { alert: { message: 'Disk full' } },
        headers: { 'content-type': 'application/json' },
        verified: true,
        delivery_id: 'delivery-1',
        idempotency_key: null,
        received_at: '2026-05-11T17:00:00.000Z',
      },
    });
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    expect(response.status).toBe(200);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'dispatched',
        handlerOutcome: expect.objectContaining({
          workflow_id: 'workflow-1',
          workflow_run_id: 'workflow-run-1',
          workflow_version: 3,
        }),
      }),
    );
  });

  it('T114: workflow trigger errors are recorded as failed deliveries', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue({
      ...activeHmacWebhook(),
      handler_type: 'workflow',
      handler_config: {
        type: 'workflow',
        workflow_id: 'workflow-1',
      },
    });
    dispatchInboundWebhookHandler.mockRejectedValue(new Error('Workflow engine unavailable'));
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'dispatch_failed',
    });
    expect(response.status).toBe(500);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'Workflow engine unavailable' },
        responseStatus: 500,
      }),
    );
  });

  it('T060: persists a verified delivery row before dispatch', async () => {
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    expect(response.status).toBe(200);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        authStatus: 'verified',
        requestBody: { alert: { message: 'Disk full' } },
      }),
    );
    expect(createInboundDelivery.mock.invocationCallOrder[0]).toBeLessThan(
      dispatchInboundWebhookHandler.mock.invocationCallOrder[0],
    );
  });

  it('T062: records dispatch failures on the existing delivery row', async () => {
    dispatchInboundWebhookHandler.mockRejectedValue(new Error('Required field title is missing'));
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'dispatch_failed',
    });
    expect(response.status).toBe(500);
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        authStatus: 'verified',
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'Required field title is missing' },
        responseStatus: 500,
        responseBody: {
          delivery_id: 'delivery-1',
          error: 'dispatch_failed',
        },
      }),
    );
  });

  it('T094: records malformed mapping failures without returning 500', async () => {
    dispatchInboundWebhookHandler.mockRejectedValue(new TestInboundWebhookMappingError('Invalid JSONata expression'));
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'mapping_failed',
    });
    expect(response.status).toBe(400);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'Invalid JSONata expression' },
        responseStatus: 400,
        responseBody: {
          delivery_id: 'delivery-1',
          error: 'mapping_failed',
        },
      }),
    );
  });

  it('T095: records missing required mapped fields as clear mapping failures', async () => {
    dispatchInboundWebhookHandler.mockRejectedValue(
      new TestInboundWebhookMappingError('Missing required mapped field "title" for action "createTicket"'),
    );
    const body = JSON.stringify({ alert: { severity: 'critical' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'mapping_failed',
    });
    expect(response.status).toBe(400);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'Missing required mapped field "title" for action "createTicket"' },
        responseStatus: 400,
        responseBody: {
          delivery_id: 'delivery-1',
          error: 'mapping_failed',
        },
      }),
    );
  });

  it('T096: records lookup misses from external-id actions as failed deliveries', async () => {
    dispatchInboundWebhookHandler.mockRejectedValue(new Error('lookup_miss: ticket external_id alert-42 was not found'));
    const body = JSON.stringify({ alert: { id: 'alert-42' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'dispatch_failed',
    });
    expect(response.status).toBe(500);
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'lookup_miss: ticket external_id alert-42 was not found' },
        responseStatus: 500,
        responseBody: {
          delivery_id: 'delivery-1',
          error: 'dispatch_failed',
        },
      }),
    );
  });

  it('T070: returns 429 when the webhook rate limit is exceeded', async () => {
    checkInboundWebhookRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 1500 });
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.json()).resolves.toEqual({
      delivery_id: 'delivery-1',
      error: 'rate_limited',
    });
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(checkInboundWebhookRateLimit).toHaveBeenCalledWith('tenant-a', 'webhook-1');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        authStatus: 'verified',
        dispatchStatus: 'failed',
        responseStatus: 429,
        responseBody: { error: 'rate_limited' },
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'failed',
        handlerOutcome: { error: 'rate_limited' },
        responseStatus: 429,
      }),
    );
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
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

  it('T039: returns a bodyless 401 for an unknown tenant slug', async () => {
    resolveInboundWebhookTenantSlug.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/inbound/unknown-tenant/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'sha256=anything',
      },
      body: JSON.stringify({ alert: { message: 'Disk full' } }),
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'unknown-tenant',
      webhookSlug: 'rmm-alerts',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(runWithTenant).not.toHaveBeenCalled();
    expect(lookupInboundWebhookBySlug).not.toHaveBeenCalled();
    expect(createInboundDelivery).not.toHaveBeenCalled();
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T040: returns a bodyless 401 for an unknown webhook slug under a valid tenant', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(null);
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/missing-hook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-signature': 'sha256=anything',
      },
      body: JSON.stringify({ alert: { message: 'Disk full' } }),
    });

    const { processInboundWebhookRequest } = await import('@/lib/inboundWebhooks/requestProcessor');
    const response = await processInboundWebhookRequest({
      request,
      tenantSlug: 'tenant-slug',
      webhookSlug: 'missing-hook',
    });

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(lookupInboundWebhookBySlug).toHaveBeenCalledWith(expect.anything(), 'tenant-a', 'missing-hook');
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: null,
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/missing-hook',
        authStatus: 'rejected_no_auth',
        dispatchStatus: 'failed',
        responseStatus: 401,
        responseBody: null,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T041: returns a bodyless 401 for a disabled webhook', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(inactiveHmacWebhook());
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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

    await expect(response.text()).resolves.toBe('');
    expect(response.status).toBe(401);
    expect(getTenantSecret).not.toHaveBeenCalled();
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        requestMethod: 'POST',
        requestPath: '/api/inbound/tenant-slug/rmm-alerts',
        authStatus: 'rejected_no_auth',
        dispatchStatus: 'failed',
        responseStatus: 401,
        responseBody: null,
      }),
    );
    expect(createInboundDelivery.mock.calls[0][1]).not.toHaveProperty('requestBody');
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T052: returns 200 no-op for duplicate idempotency keys within the window', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(hmacWebhookWithHeaderIdempotency());
    extractInboundWebhookIdempotencyKey.mockResolvedValue('alert-duplicate');
    findDuplicateInboundDelivery.mockResolvedValue({
      deliveryId: 'original-delivery',
      receivedAt: '2026-05-11T00:00:00.000Z',
    });
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-idempotency-key': 'alert-duplicate',
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

    await expect(response.json()).resolves.toEqual({ delivery_id: 'original-delivery', duplicate: true });
    expect(response.status).toBe(200);
    expect(findDuplicateInboundDelivery).toHaveBeenCalledWith({
      knex: expect.anything(),
      tenant: 'tenant-a',
      inboundWebhookId: 'webhook-1',
      idempotencyKey: 'alert-duplicate',
      windowSeconds: 86_400,
    });
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        idempotencyKey: 'alert-duplicate',
        requestBody: { alert: { message: 'Disk full' } },
        authStatus: 'verified',
        dispatchStatus: 'duplicate',
        responseStatus: 200,
        responseBody: { delivery_id: 'original-delivery', duplicate: true },
      }),
    );
    expect(updateInboundDeliveryOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        deliveryId: 'delivery-1',
        dispatchStatus: 'duplicate',
        handlerOutcome: { duplicate_of: 'original-delivery' },
        responseStatus: 200,
        responseBody: { delivery_id: 'original-delivery', duplicate: true },
      }),
    );
    expect(dispatchInboundWebhookHandler).not.toHaveBeenCalled();
  });

  it('T054: accepts a request when the configured idempotency key is missing', async () => {
    lookupInboundWebhookBySlug.mockResolvedValue(hmacWebhookWithHeaderIdempotency());
    extractInboundWebhookIdempotencyKey.mockResolvedValue(null);
    const body = JSON.stringify({ alert: { message: 'Disk full' } });
    const request = new NextRequest('http://localhost/api/inbound/tenant-slug/rmm-alerts', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
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
    expect(findDuplicateInboundDelivery).toHaveBeenCalledWith({
      knex: expect.anything(),
      tenant: 'tenant-a',
      inboundWebhookId: 'webhook-1',
      idempotencyKey: null,
      windowSeconds: 86_400,
    });
    expect(createInboundDelivery).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenant: 'tenant-a',
        inboundWebhookId: 'webhook-1',
        idempotencyKey: null,
        requestBody: { alert: { message: 'Disk full' } },
        authStatus: 'verified',
      }),
    );
    expect(dispatchInboundWebhookHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: 'delivery-1',
        idempotencyKey: null,
        body: { alert: { message: 'Disk full' } },
      }),
    );
  });
});
