/**
 * Tests for the SMTP provider's nodemailer mail-options construction
 * and config validation (no real SMTP connection is made).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '@alga-psa/types';

const createTransportMock = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: (...args: unknown[]) => createTransportMock(...args)
  }
}));

import { SMTPEmailProvider } from '../SMTPEmailProvider';

function createTransporterMock() {
  return {
    verify: vi.fn(async () => true),
    sendMail: vi.fn(async () => ({
      messageId: '<smtp-msg-1@test>',
      response: '250 OK',
      envelope: { from: 'noreply@alga.test', to: ['one@example.com'] }
    }))
  };
}

const validConfig = {
  host: 'smtp.example.com',
  port: 587,
  username: 'mailer',
  password: 'secret',
  from: 'noreply@alga.test'
};

async function initializedProvider() {
  const transporter = createTransporterMock();
  createTransportMock.mockReturnValue(transporter);
  const provider = new SMTPEmailProvider('smtp-test');
  await provider.initialize(validConfig);
  return { provider, transporter };
}

function baseMessage(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    from: { email: 'noreply@alga.test', name: 'Alga PSA' },
    to: [{ email: 'one@example.com', name: 'One' }, { email: 'two@example.com' }],
    subject: 'Test subject',
    text: 'plain body',
    html: '<p>html body</p>',
    ...overrides
  };
}

describe('SMTPEmailProvider mail options construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates the transport with the validated config', async () => {
    await initializedProvider();

    expect(createTransportMock).toHaveBeenCalledWith({
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      auth: { user: 'mailer', pass: 'secret' },
      tls: { rejectUnauthorized: true }
    });
  });

  it('formats named and bare addresses and joins multiple recipients', async () => {
    const { provider, transporter } = await initializedProvider();

    await provider.sendEmail(baseMessage(), 'tenant-1');

    expect(transporter.sendMail).toHaveBeenCalledWith({
      from: '"Alga PSA" <noreply@alga.test>',
      to: '"One" <one@example.com>, two@example.com',
      subject: 'Test subject',
      text: 'plain body',
      html: '<p>html body</p>'
    });
  });

  it('includes cc, bcc, replyTo, headers and converted attachments when present', async () => {
    const { provider, transporter } = await initializedProvider();
    const content = Buffer.from('attachment-bytes');

    await provider.sendEmail(
      baseMessage({
        cc: [{ email: 'cc@example.com', name: 'Carbon Copy' }],
        bcc: [{ email: 'bcc@example.com' }],
        replyTo: { email: 'reply@example.com' },
        headers: { 'X-Custom': 'yes' },
        attachments: [
          { filename: 'invoice.pdf', content, contentType: 'application/pdf', cid: 'inv-1' },
          { filename: 'note.txt', content: 'hello' }
        ]
      }),
      'tenant-1'
    );

    const mailOptions = transporter.sendMail.mock.calls[0][0];
    expect(mailOptions.cc).toBe('"Carbon Copy" <cc@example.com>');
    expect(mailOptions.bcc).toBe('bcc@example.com');
    expect(mailOptions.replyTo).toBe('reply@example.com');
    expect(mailOptions.headers).toEqual({ 'X-Custom': 'yes' });
    expect(mailOptions.attachments).toEqual([
      { filename: 'invoice.pdf', content, contentType: 'application/pdf', cid: 'inv-1' },
      { filename: 'note.txt', content: 'hello' }
    ]);
  });

  it('returns a successful result carrying the transport message id', async () => {
    const { provider } = await initializedProvider();

    const result = await provider.sendEmail(baseMessage(), 'tenant-1');

    expect(result).toMatchObject({
      success: true,
      messageId: '<smtp-msg-1@test>',
      providerMessageId: '<smtp-msg-1@test>',
      providerType: 'smtp',
      metadata: {
        response: '250 OK',
        envelope: { from: 'noreply@alga.test', to: ['one@example.com'] }
      }
    });
  });

  it('flags transient transport failures as retryable in the result metadata', async () => {
    const { provider, transporter } = await initializedProvider();
    transporter.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('connection reset'), { code: 'ECONNRESET', command: 'CONN' })
    );

    const result = await provider.sendEmail(baseMessage(), 'tenant-1');

    expect(result.success).toBe(false);
    expect(result.error).toBe('connection reset');
    expect(result.metadata).toMatchObject({ errorCode: 'ECONNRESET', retryable: true });
  });

  it('flags 4xx SMTP response codes as retryable and 5xx as permanent', async () => {
    const { provider, transporter } = await initializedProvider();

    transporter.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('mailbox busy'), { responseCode: 450 })
    );
    const transient = await provider.sendEmail(baseMessage(), 'tenant-1');
    expect(transient.metadata).toMatchObject({ retryable: true });

    transporter.sendMail.mockRejectedValueOnce(
      Object.assign(new Error('no such user'), { responseCode: 550 })
    );
    const permanent = await provider.sendEmail(baseMessage(), 'tenant-1');
    expect(permanent.metadata).toMatchObject({ retryable: false });
  });
});

describe('SMTPEmailProvider config validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createTransportMock.mockReturnValue(createTransporterMock());
  });

  it('rejects configs with missing required fields', async () => {
    const provider = new SMTPEmailProvider('smtp-test');

    await expect(provider.initialize({ host: 'smtp.example.com' })).rejects.toMatchObject({
      name: 'EmailProviderError',
      errorCode: 'INIT_FAILED'
    });
    await expect(provider.initialize({ host: 'smtp.example.com' })).rejects.toThrow(
      /Missing required SMTP configuration fields: port, username, password, from/
    );
  });

  it('rejects invalid port numbers', async () => {
    const provider = new SMTPEmailProvider('smtp-test');

    await expect(
      provider.initialize({ ...validConfig, port: 'not-a-port' })
    ).rejects.toThrow(/Invalid SMTP port number/);
  });

  it('defaults secure to true for port 465 and false otherwise', async () => {
    const provider465 = new SMTPEmailProvider('smtp-465');
    await provider465.initialize({ ...validConfig, port: 465 });
    expect(createTransportMock.mock.calls.at(-1)![0].secure).toBe(true);

    const provider25 = new SMTPEmailProvider('smtp-25');
    await provider25.initialize({ ...validConfig, port: 25 });
    expect(createTransportMock.mock.calls.at(-1)![0].secure).toBe(false);
  });

  it('passes requireTLS through to the transport when enabled', async () => {
    const provider = new SMTPEmailProvider('smtp-tls');
    await provider.initialize({ ...validConfig, requireTLS: true, rejectUnauthorized: false });

    expect(createTransportMock.mock.calls.at(-1)![0]).toMatchObject({
      requireTLS: true,
      tls: { rejectUnauthorized: false }
    });
  });

  it('refuses to send before initialization', async () => {
    const provider = new SMTPEmailProvider('smtp-uninitialized');

    await expect(provider.sendEmail(baseMessage(), 'tenant-1')).rejects.toMatchObject({
      name: 'EmailProviderError',
      errorCode: 'NOT_INITIALIZED'
    });
  });
});
