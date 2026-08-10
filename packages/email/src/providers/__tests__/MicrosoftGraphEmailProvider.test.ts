import { beforeEach, describe, expect, it, vi } from 'vitest';
import { simpleParser } from 'mailparser';
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

function countSequence(buffer: Buffer, sequence: string): number {
  const needle = Buffer.from(sequence);
  let count = 0;
  let index = 0;
  while ((index = buffer.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

interface ParsedGraphMime {
  html: string | false;
  text?: string;
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[] | string;
  from?: { value: Array<{ address?: string; name: string }> };
  replyTo?: { value: Array<{ address?: string; name: string }> };
  to?: { value: Array<{ address?: string; name: string }> };
  cc?: { value: Array<{ address?: string; name: string }> };
  bcc?: { value: Array<{ address?: string; name: string }> };
  headers: Map<string, unknown>;
  attachments: Array<{
    filename?: string;
    contentType: string;
    contentDisposition: string;
    cid?: string;
    content: Buffer;
  }>;
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

  it('emits CRLF-clean MIME that survives parsing as a recipient would see it', async () => {
    const html =
      '<div style="font-family:Arial,sans-serif;color:#333333;background-color:#f7f7f7;padding:16px;border:1px solid #dddddd;border-radius:6px;max-width:640px;margin:0 auto">' +
      '<p style="font-size:16px;line-height:1.5;margin:0 0 12px 0">Hi \u00b7 customer, your request has been updated.</p>' +
      '<p data-alga-reply-token="a3f9c1e2-8b4d-4f6a-9c2e-5d8b1a4f7c9d" data-alga-ticket-id="ticket-1842" data-alga-comment-id="comment-99371" data-alga-reply-boundary="BEGIN-ALGA-REPLY" style="display:none">' +
      'ALGA HIDDEN REPLY MARKER: any reply above this line is appended to ticket #1842 for the tenant billing review.' +
      '</p>' +
      '<p>Our team resolved this request. The endpoint at <code>10.20.30.41</code> was decommissioned and removed from monitoring; the alert rule and its associated maintenance window have both been closed out.</p>' +
      '<img src="cid:alga-logo@example.com" alt="Alga" width="180" height="60" style="margin-top:16px;display:block"/>' +
      '</div>';
    const text = 'Hi \u00b7 customer\n\nYour ticket #1842 is resolved. Reply above this line to reopen it.\n';
    const logoBytes = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const pdfBytes = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x00, 0xff, 0xfe, 0x01]);
    const references = [
      '<customer-message-1234567890@example.net>',
      '<support-message-000001@example.com>',
      '<support-message-000002@example.com>',
      '<support-message-000003@example.com>',
    ];
    const fromName = 'Example MSP Support';

    const provider = new MicrosoftGraphEmailProvider('microsoft-provider-1');
    await provider.initialize(providerConfig());

    await provider.sendEmail(message({
      from: { email: 'ignored@example.net', name: fromName },
      subject: 'Ticket #1842 resolved \u00b7 follow-up',
      text,
      html,
      replyTo: { email: 'replies@example.com', name: 'Ticket replies' },
      headers: {
        'Message-ID': '<ticket-reply-1@example.com>',
        'In-Reply-To': '<customer-message-1234567890@example.net>',
        References: references.join(' '),
        'Auto-Submitted': 'auto-generated',
        'X-Auto-Response-Suppress': 'OOF, AutoReply, AutoForward',
      },
      attachments: [
        {
          filename: 'alga-logo.png',
          content: logoBytes,
          contentType: 'image/png',
          cid: 'alga-logo@example.com',
        },
        {
          filename: 'invoice-1842.pdf',
          content: pdfBytes,
          contentType: 'application/pdf',
        },
      ],
    }), 'tenant-1');

    expect(sendMailMock).toHaveBeenCalledOnce();
    const payload = sendMailMock.mock.calls[0]?.[0];
    expect(payload.kind).toBe('mime');
    const rawMime = Buffer.from(payload.content, 'base64');

    let bareLf = 0;
    let crlf = 0;
    for (let i = 0; i < rawMime.length; i++) {
      if (rawMime[i] === 0x0a) {
        if (i > 0 && rawMime[i - 1] === 0x0d) crlf += 1;
        else bareLf += 1;
      }
    }
    expect(crlf).toBeGreaterThan(0);
    expect(bareLf).toBe(0);

    const qpSoftWraps = countSequence(rawMime, '=\r\n');
    const qpBareWraps = countSequence(rawMime, '=\n');
    expect(qpSoftWraps).toBeGreaterThan(0);
    expect(qpBareWraps).toBe(0);

    const parsed = (await simpleParser(rawMime, { skipImageLinks: true })) as ParsedGraphMime;

    expect(parsed.html).toBe(html);
    expect(parsed.text).toBe(text);

    expect(parsed.from?.value[0]).toEqual({ address: 'support+desk@example.com', name: fromName });
    expect(parsed.replyTo?.value[0]).toEqual({ address: 'replies@example.com', name: 'Ticket replies' });
    expect(parsed.to?.value).toEqual([{ address: 'customer@example.net', name: 'Customer' }]);
    expect(parsed.cc?.value).toEqual([{ address: 'cc@example.net', name: '' }]);
    expect(parsed.bcc?.value).toEqual([{ address: 'bcc@example.net', name: '' }]);
    expect(parsed.subject).toBe('Ticket #1842 resolved \u00b7 follow-up');
    expect(parsed.messageId).toBe('<ticket-reply-1@example.com>');
    expect(parsed.inReplyTo).toBe('<customer-message-1234567890@example.net>');
    expect(parsed.references).toEqual(references);
    expect(parsed.headers.get('auto-submitted')).toBe('auto-generated');
    expect(parsed.headers.get('x-auto-response-suppress')).toBe('OOF, AutoReply, AutoForward');

    const logo = parsed.attachments.find(attachment => attachment.filename === 'alga-logo.png');
    expect(logo).toBeDefined();
    expect(logo!.contentType).toBe('image/png');
    expect(logo!.contentDisposition).toBe('inline');
    expect(logo!.cid).toBe('alga-logo@example.com');
    expect(logo!.content.equals(logoBytes)).toBe(true);

    const pdf = parsed.attachments.find(attachment => attachment.filename === 'invoice-1842.pdf');
    expect(pdf).toBeDefined();
    expect(pdf!.contentType).toBe('application/pdf');
    expect(pdf!.contentDisposition).toBe('attachment');
    expect(pdf!.content.equals(pdfBytes)).toBe(true);
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
