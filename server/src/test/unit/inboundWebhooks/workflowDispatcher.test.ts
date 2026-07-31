import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  launchPublishedWorkflowRun: vi.fn(),
  isEnterprise: true,
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: mocks.launchPublishedWorkflowRun,
}));

vi.mock('@alga-psa/core/features', () => ({
  get isEnterprise() {
    return mocks.isEnterprise;
  },
}));

describe('inbound webhook workflow dispatcher', () => {
  const knex = { name: 'tenant-knex' };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isEnterprise = true;
    mocks.createTenantKnex.mockResolvedValue({ knex });
    mocks.launchPublishedWorkflowRun.mockResolvedValue({
      runId: 'workflow-run-1',
      workflowVersion: 7,
    });
  });

  it('T110: workflow handlers start a workflow run with the documented inbound envelope', async () => {
    const { dispatchInboundWebhookHandler } = await import('@/lib/inboundWebhooks/dispatcher');
    const outcome = await dispatchInboundWebhookHandler({
      webhook: {
        tenant: 'tenant-a',
        slug: 'rmm-alerts',
        handler_type: 'workflow',
        handler_config: {
          type: 'workflow',
          workflow_id: 'workflow-1',
        },
      },
      deliveryId: 'delivery-1',
      idempotencyKey: 'alert-42',
      body: {
        alert: {
          id: 'alert-42',
          message: 'Disk full',
        },
      },
      headers: {
        'content-type': 'application/json',
        'x-monitor': 'auvik',
      },
    });

    expect(mocks.createTenantKnex).toHaveBeenCalledWith('tenant-a');
    expect(mocks.launchPublishedWorkflowRun).toHaveBeenCalledWith(knex, {
      workflowId: 'workflow-1',
      tenantId: 'tenant-a',
      payload: expect.objectContaining({
        source: 'rmm-alerts',
        body: {
          alert: {
            id: 'alert-42',
            message: 'Disk full',
          },
        },
        headers: {
          'content-type': 'application/json',
          'x-monitor': 'auvik',
        },
        verified: true,
        delivery_id: 'delivery-1',
        idempotency_key: 'alert-42',
        received_at: expect.any(String),
      }),
      triggerType: 'event',
      triggerMetadata: {
        source: 'inbound_webhook',
        webhook_slug: 'rmm-alerts',
        delivery_id: 'delivery-1',
        idempotency_key: 'alert-42',
      },
      triggerFireKey: 'inbound-webhook:delivery-1',
      eventType: 'INBOUND_WEBHOOK_RECEIVED',
      sourcePayloadSchemaRef: 'payload.InboundWebhookReceived.v1',
      executionKey: 'inbound-webhook:delivery-1',
    });
    expect(outcome).toEqual({
      workflow_id: 'workflow-1',
      workflow_run_id: 'workflow-run-1',
      workflow_version: 7,
      envelope: expect.objectContaining({
        source: 'rmm-alerts',
        delivery_id: 'delivery-1',
      }),
    });
  });

  it('T201: workflow handler returns the launched run id for delivery logs and workflow runs navigation', async () => {
    mocks.launchPublishedWorkflowRun.mockResolvedValueOnce({
      runId: 'workflow-run-visible-1',
      workflowVersion: 9,
    });

    const { dispatchInboundWebhookHandler } = await import('@/lib/inboundWebhooks/dispatcher');
    const outcome = await dispatchInboundWebhookHandler({
      webhook: {
        tenant: 'tenant-a',
        slug: 'workflow-alerts',
        handler_type: 'workflow',
        handler_config: {
          type: 'workflow',
          workflow_id: 'workflow-visible',
        },
      },
      deliveryId: 'delivery-visible-1',
      idempotencyKey: 'alert-visible-1',
      body: {
        alert: {
          id: 'alert-visible-1',
          message: 'Run workflow triage',
        },
      },
      headers: {
        'x-source': 'rmm',
      },
    });

    expect(mocks.launchPublishedWorkflowRun).toHaveBeenCalledWith(
      knex,
      expect.objectContaining({
        workflowId: 'workflow-visible',
        tenantId: 'tenant-a',
        triggerType: 'event',
        eventType: 'INBOUND_WEBHOOK_RECEIVED',
        triggerFireKey: 'inbound-webhook:delivery-visible-1',
        executionKey: 'inbound-webhook:delivery-visible-1',
      }),
    );
    expect(outcome).toEqual({
      workflow_id: 'workflow-visible',
      workflow_run_id: 'workflow-run-visible-1',
      workflow_version: 9,
      envelope: expect.objectContaining({
        source: 'workflow-alerts',
        delivery_id: 'delivery-visible-1',
        idempotency_key: 'alert-visible-1',
      }),
    });
  });

  it('T112: workflow envelope headers are filtered before launch', async () => {
    const { dispatchInboundWebhookHandler } = await import('@/lib/inboundWebhooks/dispatcher');
    await dispatchInboundWebhookHandler({
      webhook: {
        tenant: 'tenant-a',
        slug: 'payment-alerts',
        handler_type: 'workflow',
        handler_config: {
          type: 'workflow',
          workflow_id: 'workflow-2',
        },
      },
      deliveryId: 'delivery-2',
      idempotencyKey: null,
      body: { event: 'payment_failed' },
      headers: {
        authorization: 'Bearer secret',
        cookie: 'session=secret',
        'set-cookie': 'session=secret',
        'x-api-key': 'secret',
        'x-source': 'stripe',
      },
    });

    expect(mocks.launchPublishedWorkflowRun).toHaveBeenCalledWith(
      knex,
      expect.objectContaining({
        payload: expect.objectContaining({
          headers: {
            'x-source': 'stripe',
          },
        }),
      }),
    );
  });

  it('T115: workflow dispatch succeeds once the run is launched without waiting for completion', async () => {
    mocks.launchPublishedWorkflowRun.mockResolvedValueOnce({
      runId: 'workflow-run-that-may-fail-later',
      workflowVersion: 2,
    });
    const { dispatchInboundWebhookHandler } = await import('@/lib/inboundWebhooks/dispatcher');

    await expect(
      dispatchInboundWebhookHandler({
        webhook: {
          tenant: 'tenant-a',
          slug: 'triage-alerts',
          handler_type: 'workflow',
          handler_config: {
            type: 'workflow',
            workflow_id: 'workflow-3',
          },
        },
        deliveryId: 'delivery-3',
        idempotencyKey: 'alert-99',
        body: { alert: { id: 'alert-99' } },
        headers: {},
      }),
    ).resolves.toEqual({
      workflow_id: 'workflow-3',
      workflow_run_id: 'workflow-run-that-may-fail-later',
      workflow_version: 2,
      envelope: expect.objectContaining({
        delivery_id: 'delivery-3',
      }),
    });

    expect(mocks.launchPublishedWorkflowRun).toHaveBeenCalledWith(
      knex,
      expect.objectContaining({
        executionKey: 'inbound-webhook:delivery-3',
      }),
    );
  });

  it('rejects workflow handlers outside Enterprise edition', async () => {
    mocks.isEnterprise = false;

    const { dispatchInboundWebhookHandler } = await import('@/lib/inboundWebhooks/dispatcher');

    await expect(
      dispatchInboundWebhookHandler({
        webhook: {
          tenant: 'tenant-a',
          slug: 'triage-alerts',
          handler_type: 'workflow',
          handler_config: {
            type: 'workflow',
            workflow_id: 'workflow-3',
          },
        },
        deliveryId: 'delivery-3',
        idempotencyKey: 'alert-99',
        body: { alert: { id: 'alert-99' } },
        headers: {},
      }),
    ).rejects.toThrow('Inbound webhook workflow handlers require Enterprise edition');
    expect(mocks.createTenantKnex).not.toHaveBeenCalled();
    expect(mocks.launchPublishedWorkflowRun).not.toHaveBeenCalled();
  });
});
