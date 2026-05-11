import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createTenantKnex: vi.fn(),
  launchPublishedWorkflowRun: vi.fn(),
}));

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: mocks.createTenantKnex,
}));

vi.mock('@alga-psa/workflows/lib/workflowRunLauncher', () => ({
  launchPublishedWorkflowRun: mocks.launchPublishedWorkflowRun,
}));

describe('inbound webhook workflow dispatcher', () => {
  const knex = { name: 'tenant-knex' };

  beforeEach(() => {
    vi.clearAllMocks();
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
      execute: true,
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
});
