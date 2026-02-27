import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

let providerRow: any;
const tableReads: string[] = [];

const getAdminConnectionMock = vi.fn(async () => knexMock);
const publishEventMock = vi.fn(async () => 'stream-1');

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
    publishEventMock.mockClear();
    whereMock.mockClear();
    firstMock.mockClear();
    knexMock.mockClear();
  });

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
});
