/**
 * Tests for the Resend provider's request payload construction:
 * domain EmailMessage -> Resend API JSON (address formatting, cc/bcc,
 * reply_to, attachment base64 encoding, tags object -> array).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailMessage } from '@alga-psa/types';

const axiosCreateMock = vi.fn();

vi.mock('axios', () => {
  const axios = {
    create: (...args: unknown[]) => axiosCreateMock(...args),
    isAxiosError: (error: unknown) => Boolean((error as any)?.isAxiosError)
  };
  return { default: axios, ...axios };
});

import { ResendEmailProvider } from '../ResendEmailProvider';

let providerCounter = 0;

function createClientMock() {
  return {
    post: vi.fn(async () => ({
      data: { id: 'resend-msg-1', from: 'a@b.c', to: ['x@y.z'], created_at: '2024-06-01T00:00:00.000Z' }
    })),
    get: vi.fn(async () => ({ data: { data: [] } }))
  };
}

async function initializedProvider() {
  const client = createClientMock();
  axiosCreateMock.mockReturnValue(client);
  // Unique providerId per test to avoid the static verification cache.
  const provider = new ResendEmailProvider(`resend-test-${++providerCounter}`);
  await provider.initialize({ apiKey: 're_test_key' });
  return { provider, client };
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

describe('ResendEmailProvider payload construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('configures the axios client with the API key and base URL', async () => {
    await initializedProvider();

    expect(axiosCreateMock).toHaveBeenCalledWith({
      baseURL: 'https://api.resend.com',
      headers: {
        Authorization: 'Bearer re_test_key',
        'Content-Type': 'application/json'
      },
      timeout: 30000
    });
  });

  it('builds the exact /emails payload for a simple message', async () => {
    const { provider, client } = await initializedProvider();

    await provider.sendEmail(baseMessage());

    expect(client.post).toHaveBeenCalledTimes(1);
    const [url, payload] = client.post.mock.calls[0];
    expect(url).toBe('/emails');
    expect(payload).toEqual({
      from: 'Alga PSA <noreply@alga.test>',
      to: ['one@example.com', 'two@example.com'],
      subject: 'Test subject',
      text: 'plain body',
      html: '<p>html body</p>'
    });
  });

  it('uses the bare email address when the from name is empty', async () => {
    const { provider, client } = await initializedProvider();

    await provider.sendEmail(baseMessage({ from: { email: 'noreply@alga.test' } }));

    expect(client.post.mock.calls[0][1].from).toBe('noreply@alga.test');
  });

  it('maps cc, bcc and replyTo into Resend fields', async () => {
    const { provider, client } = await initializedProvider();

    await provider.sendEmail(
      baseMessage({
        cc: [{ email: 'cc@example.com' }],
        bcc: [{ email: 'bcc@example.com' }],
        replyTo: { email: 'reply@example.com', name: 'Reply' }
      })
    );

    const payload = client.post.mock.calls[0][1];
    expect(payload.cc).toEqual(['cc@example.com']);
    expect(payload.bcc).toEqual(['bcc@example.com']);
    expect(payload.reply_to).toEqual(['reply@example.com']);
  });

  it('base64-encodes Buffer attachments and carries the content type', async () => {
    const { provider, client } = await initializedProvider();
    const content = Buffer.from('invoice-pdf-bytes');

    await provider.sendEmail(
      baseMessage({
        attachments: [{ filename: 'invoice.pdf', content, contentType: 'application/pdf' }]
      })
    );

    expect(client.post.mock.calls[0][1].attachments).toEqual([
      {
        filename: 'invoice.pdf',
        content: content.toString('base64'),
        content_type: 'application/pdf'
      }
    ]);
  });

  it('converts the tags record into Resend name/value pairs and forwards headers', async () => {
    const { provider, client } = await initializedProvider();

    await provider.sendEmail(
      baseMessage({
        tags: { category: 'billing', tenant: 't1' },
        headers: { 'X-Custom': 'yes' }
      })
    );

    const payload = client.post.mock.calls[0][1];
    expect(payload.tags).toEqual([
      { name: 'category', value: 'billing' },
      { name: 'tenant', value: 't1' }
    ]);
    expect(payload.headers).toEqual({ 'X-Custom': 'yes' });
  });

  it('maps the Resend response onto a successful EmailSendResult', async () => {
    const { provider } = await initializedProvider();

    const result = await provider.sendEmail(baseMessage());

    expect(result).toMatchObject({
      success: true,
      messageId: 'resend-msg-1',
      providerMessageId: 'resend-msg-1',
      providerType: 'resend',
      sentAt: new Date('2024-06-01T00:00:00.000Z')
    });
  });

  it('rejects sends before initialize() with a non-retryable provider error', async () => {
    const provider = new ResendEmailProvider(`resend-test-${++providerCounter}`);

    await expect(provider.sendEmail(baseMessage())).rejects.toMatchObject({
      name: 'EmailProviderError',
      isRetryable: false
    });
  });
});
