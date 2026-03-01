import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let providerRow: any;
const tableReads: string[] = [];

const getAdminConnectionMock = vi.fn(async () => knexMock);
const publishEventMock = vi.fn(async () => 'stream-1');
const processInboundEmailInAppMock = vi.fn(async () => ({ outcome: 'created', ticketId: 't-1' }));
const enqueueUnifiedInboundEmailQueueJobMock = vi.fn();
const enqueueImapInAppJobMock = vi.fn();

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

vi.mock('@alga-psa/shared/events/publisher', () => ({
  publishEvent: (...args: any[]) => publishEventMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/processInboundEmailInApp', () => ({
  processInboundEmailInApp: (...args: any[]) => processInboundEmailInAppMock(...args),
}));

vi.mock('@alga-psa/shared/services/email/unifiedInboundEmailQueue', () => ({
  enqueueUnifiedInboundEmailQueueJob: (...args: any[]) => enqueueUnifiedInboundEmailQueueJobMock(...args),
}));

vi.mock('@alga-psa/integrations/webhooks/email/imapInAppQueue', () => ({
  enqueueImapInAppJob: (...args: any[]) => enqueueImapInAppJobMock(...args),
}));

describe('IMAP webhook handoff', () => {
  beforeEach(() => {
    process.env.IMAP_WEBHOOK_SECRET = 'imap-secret';
    process.env.INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = '';
    process.env.INBOUND_EMAIL_IN_APP_PROVIDER_IDS = '';
    process.env.INBOUND_EMAIL_IN_APP_TENANT_IDS = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROVIDER_IDS = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_TENANT_IDS = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_EVENT_BUS_FALLBACK_ENABLED = '';
    process.env.IMAP_MAX_ATTACHMENT_BYTES = '';
    process.env.IMAP_MAX_TOTAL_ATTACHMENT_BYTES = '';
    process.env.IMAP_MAX_ATTACHMENT_COUNT = '';
    process.env.IMAP_MAX_RAW_MIME_BYTES = '';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = '';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_TENANT_IDS = '';
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_PROVIDER_IDS = '';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_DISABLED = '';
    providerRow = {
      id: 'provider-imap-1',
      tenant: 'tenant-1',
      is_active: true,
      mailbox: 'support@example.com',
    };
    tableReads.length = 0;
    getAdminConnectionMock.mockClear();
    publishEventMock.mockClear();
    processInboundEmailInAppMock.mockClear();
    enqueueUnifiedInboundEmailQueueJobMock.mockReset();
    enqueueImapInAppJobMock.mockReset();
    processInboundEmailInAppMock.mockResolvedValue({ outcome: 'created', ticketId: 't-1' });
    enqueueUnifiedInboundEmailQueueJobMock.mockResolvedValue({
      job: { jobId: 'job-imap-1' },
      queueDepth: 1,
    });
    enqueueImapInAppJobMock.mockReturnValue({
      jobId: 'legacy-imap-job-1',
      queueDepth: 1,
      activeWorkers: 1,
    });
    whereMock.mockClear();
    firstMock.mockClear();
    knexMock.mockClear();
  });

  function makeImapRequest(emailDataOverrides: Record<string, any> = {}, secret = 'imap-secret') {
    return new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': secret,
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        emailData: {
          id: 'imap-msg-1',
          provider: 'imap',
          providerId: providerRow.id,
          tenant: providerRow.tenant,
          receivedAt: new Date().toISOString(),
          from: { email: 'sender@example.com' },
          to: [{ email: 'support@example.com' }],
          subject: 'IMAP inbound',
          body: { text: 'Body', html: '<p>Body</p>' },
          attachments: [],
          ...emailDataOverrides,
        },
      }),
    });
  }

  it('T035: returns success after auth/validation + async handoff without inline persistence work', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        emailData: {
          id: 'imap-msg-1',
          provider: 'imap',
          providerId: providerRow.id,
          tenant: providerRow.tenant,
          receivedAt: new Date().toISOString(),
          from: { email: 'sender@example.com' },
          to: [{ email: 'support@example.com' }],
          subject: 'IMAP inbound',
          body: { text: 'Body', html: '<p>Body</p>' },
          attachments: [
            {
              id: 'att-1',
              name: 'file.txt',
              contentType: 'text/plain',
              size: 4,
              content: Buffer.from('data').toString('base64'),
            },
          ],
          rawMimeBase64: Buffer.from('mime-body').toString('base64'),
        },
      }),
    });

    const startedAt = Date.now();
    const response = await POST(request);
    const elapsedMs = Date.now() - startedAt;

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'event_bus',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      messageId: 'imap-msg-1',
    });

    expect(getAdminConnectionMock).toHaveBeenCalledTimes(1);
    expect(tableReads).toEqual(['email_providers']);
    expect(publishEventMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'INBOUND_EMAIL_RECEIVED',
        tenant: providerRow.tenant,
        payload: expect.objectContaining({
          providerId: providerRow.id,
          tenantId: providerRow.tenant,
          emailData: expect.objectContaining({
            id: 'imap-msg-1',
            rawMimeBase64: expect.any(String),
          }),
        }),
      })
    );
    expect(elapsedMs).toBeLessThan(2000);
  });

  it('T036: rejects invalid secret before provider lookup or event handoff', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'wrong-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        emailData: { id: 'imap-msg-bad' },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(getAdminConnectionMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
    expect(tableReads).toHaveLength(0);
  });

  it('T229: IMAP callback processes via in-app mode when IMAP in-app flag is enabled', async () => {
    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'true';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makeImapRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: false,
      handoff: 'in_app',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      messageId: 'imap-msg-1',
    });

    expect(processInboundEmailInAppMock).toHaveBeenCalledTimes(1);
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('T230: IMAP callback follows fallback path when in-app mode is disabled', async () => {
    process.env.IMAP_INBOUND_EMAIL_IN_APP_PROCESSING_ENABLED = 'false';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(makeImapRequest());
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'event_bus',
      providerId: providerRow.id,
      tenant: providerRow.tenant,
      messageId: 'imap-msg-1',
    });

    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();
    expect(publishEventMock).toHaveBeenCalledTimes(1);
  });

  it('T231: over-limit single attachment is skipped with attachment_over_max_bytes reason', async () => {
    process.env.IMAP_MAX_ATTACHMENT_BYTES = '3';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(
      makeImapRequest({
        attachments: [
          {
            id: 'att-large',
            name: 'large.bin',
            contentType: 'application/octet-stream',
            size: 4,
            content: Buffer.from('data').toString('base64'),
          },
        ],
      })
    );
    expect(response.status).toBe(200);
    expect(publishEventMock).toHaveBeenCalledTimes(1);

    const event = publishEventMock.mock.calls[0][0];
    expect(event.payload.emailData.attachments).toEqual([]);
    expect(event.payload.emailData.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_over_max_bytes',
        attachmentId: 'att-large',
      })
    );
  });

  it('T232: total attachment byte cap skips overflow attachments with attachment_total_bytes_exceeded reason', async () => {
    process.env.IMAP_MAX_ATTACHMENT_BYTES = '4';
    process.env.IMAP_MAX_TOTAL_ATTACHMENT_BYTES = '5';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(
      makeImapRequest({
        attachments: [
          {
            id: 'att-1',
            name: 'first.bin',
            contentType: 'application/octet-stream',
            size: 3,
            content: Buffer.from('aaa').toString('base64'),
          },
          {
            id: 'att-2',
            name: 'second.bin',
            contentType: 'application/octet-stream',
            size: 3,
            content: Buffer.from('bbb').toString('base64'),
          },
        ],
      })
    );
    expect(response.status).toBe(200);

    const event = publishEventMock.mock.calls[0][0];
    expect(event.payload.emailData.attachments).toHaveLength(1);
    expect(event.payload.emailData.attachments[0].id).toBe('att-1');
    expect(event.payload.emailData.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_total_bytes_exceeded',
        attachmentId: 'att-2',
      })
    );
  });

  it('T233: attachment count cap emits attachment_count_exceeded for excess attachments', async () => {
    process.env.IMAP_MAX_ATTACHMENT_COUNT = '1';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(
      makeImapRequest({
        attachments: [
          {
            id: 'att-1',
            name: 'first.bin',
            contentType: 'application/octet-stream',
            size: 1,
            content: Buffer.from('a').toString('base64'),
          },
          {
            id: 'att-2',
            name: 'second.bin',
            contentType: 'application/octet-stream',
            size: 1,
            content: Buffer.from('b').toString('base64'),
          },
        ],
      })
    );
    expect(response.status).toBe(200);

    const event = publishEventMock.mock.calls[0][0];
    expect(event.payload.emailData.attachments).toHaveLength(1);
    expect(event.payload.emailData.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'attachment',
        reason: 'attachment_count_exceeded',
        attachmentId: 'att-2',
      })
    );
  });

  it('T234: raw MIME over-cap emits raw_mime_over_max_bytes and strips MIME source fields', async () => {
    process.env.IMAP_MAX_RAW_MIME_BYTES = '3';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const response = await POST(
      makeImapRequest({
        rawMimeBase64: Buffer.from('mime-too-large').toString('base64'),
      })
    );
    expect(response.status).toBe(200);

    const event = publishEventMock.mock.calls[0][0];
    expect(event.payload.emailData.rawMimeBase64).toBeUndefined();
    expect(event.payload.emailData.sourceMimeBase64).toBeUndefined();
    expect(event.payload.emailData.rawSourceBase64).toBeUndefined();
    expect(event.payload.emailData.ingressSkipReasons).toContainEqual(
      expect.objectContaining({
        type: 'raw_mime',
        reason: 'raw_mime_over_max_bytes',
      })
    );
  });

  it('T237: payload contract accepts attachment content/isInline/contentId and MIME source fields', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');
    const response = await POST(
      makeImapRequest({
        attachments: [
          {
            id: 'att-contract',
            name: 'contract.txt',
            contentType: 'text/plain',
            size: 4,
            contentId: '<cid-contract>',
            isInline: true,
            content: Buffer.from('test').toString('base64'),
          },
        ],
        sourceMimeBase64: Buffer.from('source-mime').toString('base64'),
      })
    );
    expect(response.status).toBe(200);

    const event = publishEventMock.mock.calls[0][0];
    expect(event.payload.emailData.attachments[0]).toMatchObject({
      id: 'att-contract',
      contentId: '<cid-contract>',
      isInline: true,
      content: Buffer.from('test').toString('base64'),
    });
    expect(event.payload.emailData.sourceMimeBase64).toBe(Buffer.from('source-mime').toString('base64'));
  });

  it('T238: malformed attachment content payload fails validation safely', async () => {
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');
    const response = await POST(
      makeImapRequest({
        attachments: [
          {
            id: 'att-bad',
            name: 'bad.txt',
            contentType: 'text/plain',
            size: 4,
            content: { invalid: true },
          },
        ],
      })
    );

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body).toMatchObject({
      error: expect.stringContaining('attachments[0].content'),
    });
    expect(processInboundEmailInAppMock).not.toHaveBeenCalled();
    expect(publishEventMock).not.toHaveBeenCalled();
  });

  it('T003: IMAP ingress enqueues a pointer-only unified queue payload with required identifiers', async () => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        pointer: {
          mailbox: 'INBOX',
          uid: '77',
          uidValidity: '999',
          messageId: '<imap-msg-77@example.com>',
        },
      }),
    });

    const response = await POST(request);
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
    const enqueuePayload = enqueueUnifiedInboundEmailQueueJobMock.mock.calls[0][0];
    expect(enqueuePayload).toMatchObject({
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
    expect(enqueuePayload).not.toHaveProperty('emailData');
    expect(enqueuePayload).not.toHaveProperty('attachments');
    expect(enqueuePayload).not.toHaveProperty('rawMimeBase64');
  });

  it('T006: IMAP callback success waits for durable enqueue completion', async () => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    let resolveEnqueue!: (value: { job: { jobId: string }; queueDepth: number }) => void;
    const enqueueGate = new Promise<{ job: { jobId: string }; queueDepth: number }>((resolve) => {
      resolveEnqueue = resolve;
    });
    enqueueUnifiedInboundEmailQueueJobMock.mockImplementation(() => enqueueGate);

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        pointer: {
          mailbox: 'INBOX',
          uid: '88',
        },
      }),
    });

    let settled = false;
    const responsePromise = POST(request).then((response) => {
      settled = true;
      return response;
    });

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
    });
  });

  it('T007: IMAP unified ingress returns non-2xx when enqueue fails', async () => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    enqueueUnifiedInboundEmailQueueJobMock.mockRejectedValue(new Error('redis unavailable'));
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        pointer: {
          mailbox: 'INBOX',
          uid: '99',
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body).toMatchObject({
      error: 'Failed to enqueue IMAP pointer job',
    });
  });

  it('T026: legacy IMAP in-memory queue path is bypassed when unified queue mode is enabled', async () => {
    process.env.UNIFIED_INBOUND_EMAIL_POINTER_QUEUE_ENABLED = 'true';
    process.env.IMAP_INBOUND_EMAIL_IN_APP_ASYNC_ENABLED = 'true';
    const { POST } = await import('@alga-psa/integrations/webhooks/email/imap');

    const request = new NextRequest('http://localhost:3000/api/email/webhooks/imap', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-imap-webhook-secret': 'imap-secret',
      },
      body: JSON.stringify({
        providerId: providerRow.id,
        tenant: providerRow.tenant,
        pointer: {
          mailbox: 'INBOX',
          uid: '111',
        },
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      success: true,
      queued: true,
      handoff: 'unified_pointer_queue',
      uid: '111',
    });

    expect(enqueueUnifiedInboundEmailQueueJobMock).toHaveBeenCalledTimes(1);
    expect(enqueueImapInAppJobMock).not.toHaveBeenCalled();
  });
});
