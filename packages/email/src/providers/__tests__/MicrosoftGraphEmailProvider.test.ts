import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '@alga-psa/types';

const { connectMock, sendMailMock, testConnectionMock } = vi.hoisted(() => ({
  connectMock: vi.fn(),
  sendMailMock: vi.fn(),
  testConnectionMock: vi.fn(),
}));

vi.mock('@alga-psa/shared/services/email/providers/MicrosoftGraphAdapter', () => ({
  MicrosoftGraphAdapter: class {
    connect = connectMock;
    sendMail = sendMailMock;
    testConnection = testConnectionMock;
  },
}));

import { MicrosoftGraphEmailProvider } from '../MicrosoftGraphEmailProvider';

function makeJwt(scopes: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ scp: scopes })).toString('base64url');
  return `${header}.${payload}.signature`;
}

function providerConfig(accessToken = makeJwt('Mail.Read Mail.Read.Shared Mail.Send')) {
  return {
    inboundProvider: {
      id: 'microsoft-provider-1',
      tenant: 'tenant-1',
      name: 'Support mailbox',
      provider_type: 'microsoft',
      mailbox: 'support+desk@example.com',
      folder_to_monitor: 'Inbox',
      active: true,
      webhook_notification_url: '',
      connection_status: 'connected',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
      provider_config: {
        access_token: accessToken,
        refresh_token: 'refresh-token',
      },
    },
  };
}

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: { email: 'ignored@example.net', name: 'Ignored sender' },
    to: [{ email: 'customer@example.net', name: 'Customer' }],
    cc: [{ email: 'cc@example.net' }],
    bcc: [{ email: 'bcc@example.net' }],
    subject: 'Ticket reply',
    text: 'Plain reply',
    html: '<p>HTML reply</p>',
    replyTo: { email: 'replies@example.com', name: 'Ticket replies' },
    headers: {
      'Message-ID': '<ticket-anchor@example.com>',
      'In-Reply-To': '<customer-message@example.net>',
      References: '<customer-message@example.net>',
    },
    attachments: [{
      filename: 'notes.txt',
      content: Buffer.from('attachment'),
      contentType: 'text/plain',
      cid: 'inline-notes',
    }],
    ...overrides,
  };
}

describe('MicrosoftGraphEmailProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connectMock.mockResolvedValue(undefined);
    sendMailMock.mockResolvedValue({ requestId: 'graph-request-1' });
    testConnectionMock.mockResolvedValue({ success: true });
  });

  it('maps provider-neutral messages to Graph JSON', async () => {
    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
    await provider.initialize(providerConfig());

    const result = await provider.sendEmail(message({
      from: { email: 'ignored@example.net' },
      headers: undefined,
    }), 'tenant-1');

    expect(sendMailMock).toHaveBeenCalledWith({
      kind: 'json',
      message: {
        subject: 'Ticket reply',
        body: { contentType: 'HTML', content: '<p>HTML reply</p>' },
        toRecipients: [{ emailAddress: { address: 'customer@example.net', name: 'Customer' } }],
        ccRecipients: [{ emailAddress: { address: 'cc@example.net' } }],
        bccRecipients: [{ emailAddress: { address: 'bcc@example.net' } }],
        replyTo: [{ emailAddress: { address: 'replies@example.com', name: 'Ticket replies' } }],
        attachments: [{
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: 'notes.txt',
          contentType: 'text/plain',
          contentBytes: Buffer.from('attachment').toString('base64'),
          contentId: 'inline-notes',
          isInline: true,
        }],
      },
    });
    expect(result).toMatchObject({
      success: true,
      providerId: 'microsoft-provider-1',
      providerType: 'microsoft',
      metadata: { requestId: 'graph-request-1' },
    });
    expect(result.messageId).toBeUndefined();
  });

  it.each(['Example MSP', 'Example MSP Portal'])(
    'uses MIME to carry the %s display name with the selected mailbox',
    async (fromName) => {
      const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
      await provider.initialize(providerConfig());

      await provider.sendEmail(message({
        from: { email: 'ignored@example.net', name: fromName },
        headers: undefined,
        attachments: undefined,
      }), 'tenant-1');

      const payload = sendMailMock.mock.calls[0]?.[0];
      expect(payload.kind).toBe('mime');
      const mime = Buffer.from(payload.content, 'base64').toString('utf8');
      expect(mime).toContain(`From: ${fromName} <support+desk@example.com>`);
    }
  );

  it('uses MIME to retain ticket threading headers that Graph JSON cannot set', async () => {
    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
    await provider.initialize(providerConfig());

    await provider.sendEmail(message(), 'tenant-1');

    expect(sendMailMock).toHaveBeenCalledOnce();
    const payload = sendMailMock.mock.calls[0]?.[0];
    expect(payload.kind).toBe('mime');
    const mime = Buffer.from(payload.content, 'base64').toString('utf8');
    expect(mime).toContain('From: Ignored sender <support+desk@example.com>');
    expect(mime).toContain('Reply-To: Ticket replies <replies@example.com>');
    expect(mime).toContain('Message-ID: <ticket-anchor@example.com>');
    expect(mime).toContain('In-Reply-To: <customer-message@example.net>');
    expect(mime).toContain('References: <customer-message@example.net>');
    expect(mime).toContain('Bcc: bcc@example.net');
    expect(mime).toContain('filename=notes.txt');
  });

  it('requires existing connections to be re-consented for Mail.Send', async () => {
    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');

    await expect(provider.initialize(providerConfig(makeJwt('Mail.Read Mail.Read.Shared'))))
      .rejects.toMatchObject({
        name: 'EmailProviderError',
        errorCode: 'INIT_FAILED',
      });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it('returns an actionable non-retryable error for missing Send As rights', async () => {
    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
    await provider.initialize(providerConfig());
    sendMailMock.mockRejectedValue(Object.assign(new Error('Forbidden'), {
      status: 403,
      code: 'ErrorAccessDenied',
      requestId: 'graph-request-403',
    }));

    await expect(provider.sendEmail(message(), 'tenant-1')).rejects.toMatchObject({
      name: 'EmailProviderError',
      isRetryable: false,
      errorCode: 'ErrorAccessDenied',
      metadata: { status: 403, requestId: 'graph-request-403' },
    });
  });

  it('marks throttling as retryable and rejects oversized simple attachments', async () => {
    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
    await provider.initialize(providerConfig());
    sendMailMock.mockRejectedValueOnce(Object.assign(new Error('Throttled'), { status: 429 }));

    await expect(provider.sendEmail(message({ attachments: [] }), 'tenant-1')).rejects.toMatchObject({
      isRetryable: true,
      errorCode: '429',
    });

    await expect(provider.sendEmail(message({
      attachments: [{ filename: 'large.bin', content: Buffer.alloc(3 * 1024 * 1024 + 1) }],
    }), 'tenant-1')).rejects.toMatchObject({
      isRetryable: false,
      errorCode: 'ATTACHMENT_TOO_LARGE',
    });
  });
});
