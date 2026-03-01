import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();
const getAdminConnectionMock = vi.fn();
const withTransactionMock = vi.fn();

const trxMock = vi.fn();
const trxRawMock = vi.fn((expression: string) => expression);
const providerQueryMock = {
  join: vi.fn(function join() {
    return this;
  }),
  where: vi.fn(function where() {
    return this;
  }),
  andWhere: vi.fn(function andWhere() {
    return this;
  }),
  first: vi.fn(),
};

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/db', () => ({
  withTransaction: (...args: any[]) => withTransactionMock(...args),
}));

describe('Microsoft unified inbound pointer queue ingress', () => {
  beforeEach(() => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_TENANT_IDS = '';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_PROVIDER_IDS = '';

    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    getAdminConnectionMock.mockReset();
    withTransactionMock.mockReset();
    trxMock.mockReset();
    trxRawMock.mockClear();
    providerQueryMock.join.mockClear();
    providerQueryMock.where.mockClear();
    providerQueryMock.andWhere.mockClear();
    providerQueryMock.first.mockReset();

    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-ms-1' },
      queueDepth: 1,
    });

    providerQueryMock.first.mockResolvedValue({
      id: 'provider-ms-1',
      tenant: 'tenant-ms-1',
      mailbox: 'support@example.com',
      is_active: true,
      mc_webhook_verification_token: 'expected-client-state',
    });

    trxMock.mockImplementation((table: string) => {
      if (table === 'microsoft_email_provider_config as mc') {
        return providerQueryMock;
      }
      throw new Error(`Unexpected table in test transaction: ${table}`);
    });
    (trxMock as any).raw = trxRawMock;

    getAdminConnectionMock.mockResolvedValue({});
    withTransactionMock.mockImplementation(async (_conn: unknown, callback: (trx: any) => Promise<void>) => {
      await callback(trxMock);
    });
  });

  it('T001: Microsoft ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/microsoft');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/microsoft', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        value: [
          {
            changeType: 'created',
            clientState: 'expected-client-state',
            resource: '/users/user-1/messages/msg-123',
            resourceData: {
              '@odata.type': '#microsoft.graph.message',
              '@odata.id': 'msg-123',
              id: 'msg-123',
            },
            subscriptionExpirationDateTime: new Date(Date.now() + 60_000).toISOString(),
            subscriptionId: 'sub-ms-1',
            tenantId: 'tenant-ms-1',
          },
        ],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      processedCount: 1,
      unifiedQueuedCount: 1,
      inlineProcessedCount: 0,
      messageIds: ['msg-123'],
    });

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    const enqueuePayload = enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0];
    expect(enqueuePayload).toMatchObject({
      tenantId: 'tenant-ms-1',
      providerId: 'provider-ms-1',
      provider: 'microsoft',
      pointer: {
        subscriptionId: 'sub-ms-1',
        messageId: 'msg-123',
        resource: '/users/user-1/messages/msg-123',
        changeType: 'created',
      },
    });
    expect(enqueuePayload).not.toHaveProperty('emailData');
    expect(enqueuePayload).not.toHaveProperty('attachments');
    expect(enqueuePayload).not.toHaveProperty('rawMimeBase64');
  });
});
