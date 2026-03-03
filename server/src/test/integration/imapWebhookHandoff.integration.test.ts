import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let providerRow: any;
const tableReads: string[] = [];

const getAdminConnectionMock = vi.fn(async () => knexMock);
const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();

const whereMock = vi.fn(function where() {
  return this;
});
const firstMock = vi.fn(async () => providerRow);

const knexMock = vi.fn((table: string) => {
  tableReads.push(table);
  if (table !== 'email_providers') {
    throw new Error(`Unexpected table read in IMAP webhook handler: ${table}`);
  }
  return {
    where: whereMock,
    first: firstMock,
  };
});

vi.mock('@alga-psa/db/admin', () => ({
  getAdminConnection: (...args: any[]) => getAdminConnectionMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

describe('IMAP webhook handoff', () => {
  beforeEach(() => {
    process.env.IMAP_WEBHOOK_SECRET = 'imap-secret';
    providerRow = {
      id: 'provider-imap-1',
      tenant: 'tenant-1',
      is_active: true,
      mailbox: 'support@example.com',
    };
    tableReads.length = 0;
    getAdminConnectionMock.mockClear();
    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-imap-1' },
      queueDepth: 1,
    });
    whereMock.mockClear();
    firstMock.mockClear();
    knexMock.mockClear();
  });

  function makePointerRequest(
    pointerOverrides: Record<string, any> = {},
    secret = 'imap-secret',
    payloadOverrides: Record<string, any> = {}
  ) {
    return new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': secret,
      },
      body: JSON.stringify({
        providerId: providerRow?.id || 'provider-imap-missing',
        tenant: providerRow?.tenant || 'tenant-1',
        pointer: {
          mailbox: 'INBOX',
          uid: '77',
          uidValidity: '999',
          messageId: '<imap-msg-77@example.com>',
          ...pointerOverrides,
        },
        ...payloadOverrides,
      }),
    });
  }

  it('T003: IMAP ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      uid: '77',
      messageId: '<imap-msg-77@example.com>',
    });

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledWith({
      tenantId: providerRow.tenant,
      providerId: providerRow.id,
      provider: 'imap',
      pointer: {
        mailbox: 'INBOX',
        uid: '77',
        uidValidity: '999',
        messageId: '<imap-msg-77@example.com>',
      },
    });
  });

  it('T006: IMAP callback success waits for durable enqueue completion', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    let resolveEnqueue!: (value: { job: { jobId: string }; queueDepth: number }) => void;
    const enqueueGate = new Promise<{ job: { jobId: string }; queueDepth: number }>((resolve) => {
      resolveEnqueue = resolve;
    });
    enqueueUnifiedInboundEmailQueueJobMock.mockImplementation(() => enqueueGate);

    let settled = false;
    const responsePromise = POST(makePointerRequest({ uid: '88', messageId: '<imap-msg-88@example.com>' })).then(
      (response) => {
        settled = true;
        return response;
      }
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    resolveEnqueue({ job: { jobId: 'job-imap-gated' }, queueDepth: 3 });
    const response = await responsePromise;
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      uid: '88',
      messageId: '<imap-msg-88@example.com>',
    });
  });

  it('T007: IMAP unified ingress returns non-2xx when enqueue fails', async () => {
    enqueueUnifiedInboundEmailQueueJobMock.mockRejectedValue(new Error('redis unavailable'));
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({ uid: '99', messageId: '<imap-msg-99@example.com>' }));
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Failed to enqueue IMAP pointer job',
    });
  });

  it('T029: IMAP secret verification remains enforced in enqueue-only mode', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({}, 'wrong-secret'));
    expect(response.status).toBe(401);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 400 when pointer.uid is missing', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest({ uid: undefined }));
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'pointer.uid is required',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 400 when tenant hint mismatches provider tenant', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');
    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: 'other-tenant',
        pointer: { mailbox: 'INBOX', uid: '101' },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns skipped=true when provider is inactive', async () => {
    providerRow = {
      ...providerRow,
      is_active: false,
    };
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      skipped: true,
      reason: 'Provider is inactive',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });

  it('returns 404 when provider does not exist', async () => {
    providerRow = null;
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makePointerRequest());
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'IMAP provider not found',
    });
    expect(enqueueUnifiedInboundEmailQueueJobMock).not.toHaveBeenCalled();
  });
});
