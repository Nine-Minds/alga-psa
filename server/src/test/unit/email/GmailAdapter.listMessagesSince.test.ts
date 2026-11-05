import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '../../../services/email/providers/GmailAdapter';
import { GmailAdapter as SharedGmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const historyListMock = vi.fn();
const messageGetMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        history: {
          list: historyListMock
        },
        messages: {
          get: messageGetMock,
        },
      }
    }))
  }
}));

describe('GmailAdapter.listMessagesSince', () => {
  const providerConfig: EmailProviderConfig = {
    id: 'provider-id',
    tenant: 'tenant-id',
    name: 'Test Gmail Provider',
    provider_type: 'google',
    mailbox: 'user@example.com',
    folder_to_monitor: 'INBOX',
    active: true,
    webhook_notification_url: 'https://app.example.com/api/email/webhooks/google',
    connection_status: 'connected',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_config: {
      access_token: 'ya29.test-token',
      refresh_token: '1//test-refresh',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      history_id: '31559633'
    }
  };

  beforeEach(() => {
    historyListMock.mockReset();
    messageGetMock.mockReset();
  });

  it('surfaces a dedicated error when Gmail returns historyId not found', async () => {
    const adapter = new GmailAdapter(providerConfig);
    (adapter as any).accessToken = providerConfig.provider_config?.access_token;
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const notFoundError = Object.assign(new Error('Requested entity was not found.'), {
      response: {
        status: 404,
        data: {
          error: {
            code: 404,
            message: 'Requested entity was not found.',
            status: 'NOT_FOUND',
            errors: [
              {
                reason: 'notFound',
                message: 'Requested entity was not found.'
              }
            ]
          }
        }
      }
    });

    historyListMock.mockRejectedValueOnce(notFoundError);

    await expect(adapter.listMessagesSince('31559633')).rejects.toMatchObject({
      code: 'gmail.historyIdNotFound'
    });
  });

  it('attempts to recreate Gmail watch when historyId rejection occurs', async () => {
    const adapter = new GmailAdapter(providerConfig);
    (adapter as any).accessToken = providerConfig.provider_config?.access_token;
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const registerSpy = vi
      .spyOn(adapter, 'registerWebhookSubscription')
      .mockResolvedValue();

    const notFoundError = Object.assign(new Error('Requested entity was not found.'), {
      response: {
        status: 404,
        data: {
          error: {
            code: 404,
            message: 'Requested entity was not found.',
            status: 'NOT_FOUND',
            errors: [
              {
                reason: 'notFound',
                message: 'Requested entity was not found.'
              }
            ]
          }
        }
      }
    });

    historyListMock.mockRejectedValueOnce(notFoundError);

    await expect(adapter.listMessagesSince('31559633')).rejects.toMatchObject({
      code: 'gmail.historyIdNotFound'
    });

    expect(registerSpy).toHaveBeenCalledTimes(1);
  });

  it('returns raw MIME bytes from downloadMessageSource', async () => {
    const adapter = new GmailAdapter(providerConfig);
    (adapter as any).accessToken = providerConfig.provider_config?.access_token;
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const rawMime = Buffer.from('From: sender@example.com\r\n\r\nhello', 'utf8').toString('base64url');
    messageGetMock.mockResolvedValueOnce({ data: { raw: rawMime } });

    const buffer = await adapter.downloadMessageSource('message-1');
    expect(buffer.toString('utf8')).toContain('From: sender@example.com');
    expect(messageGetMock).toHaveBeenCalledWith(expect.objectContaining({
      id: 'message-1',
      format: 'raw',
    }));
  });

  it.each([
    ['server adapter', GmailAdapter],
    ['shared adapter', SharedGmailAdapter],
  ])('does not forward forged list-resolution metadata from the %s', async (_label, Adapter) => {
    const adapter = new Adapter(providerConfig);
    messageGetMock.mockResolvedValueOnce({
      data: {
        id: 'message-forged-header',
        labelIds: ['INBOX'],
        payload: {
          headers: [
            { name: 'From', value: 'Sender <sender@example.com>' },
            { name: 'To', value: 'support@example.com' },
            { name: 'Subject', value: 'Direct mail' },
            { name: 'x-resolved-original-sender', value: 'victim@example.com' },
            { name: 'X-List-Address', value: 'support@lists.example.com' },
          ],
        },
      },
    });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: sender@example.com\r\n\r\nhello').toString('base64url') } });

    const details = await adapter.getMessageDetails('message-forged-header');

    expect(details.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(details.headers).not.toHaveProperty('X-List-Address');
  });

  it('preserves ordered Gmail auth results for diagnostics without authorizing them', async () => {
    const adapter = new SharedGmailAdapter(providerConfig);
    messageGetMock.mockResolvedValueOnce({ data: {
      id: 'message-auth-results', labelIds: ['INBOX'], payload: { headers: [
        { name: 'From', value: 'Agent <agent@msp.test>' },
        { name: 'Authentication-Results', value: 'mx.google.com; dmarc=fail header.from=msp.test' },
        { name: 'Authentication-Results', value: 'attacker.test; dmarc=pass header.from=msp.test' },
      ] },
    } });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: agent@msp.test\r\n\r\nreply').toString('base64url') } });

    const details = await adapter.getMessageDetails('message-auth-results');
    expect(details.senderAuthentication?.author).toEqual({ authorization: 'confirmation_required', provenance: 'receiving_mailbox_only' });
    expect(details.senderAuthentication?.reasons).toContain('gmail_receiver_results_retained_for_diagnostics_only');
    expect(details.senderAuthentication?.contact.authorization).toBe('untrusted');
    expect(details.senderAuthentication?.diagnostics?.authenticationResults).toEqual([
      'mx.google.com; dmarc=fail header.from=msp.test',
      'attacker.test; dmarc=pass header.from=msp.test',
    ]);
    expect(Buffer.from(details.rawMimeBase64!, 'base64').toString()).toContain('reply');

    messageGetMock.mockResolvedValueOnce({ data: { id: 'message-auth-results-pass', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'Agent <agent@msp.test>' },
      { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=msp.test' },
      { name: 'Authentication-Results', value: 'relay.example; dmarc=fail header.from=msp.test' },
    ] } } });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: agent@msp.test\r\n\r\nreply').toString('base64url') } });
    const valid = await adapter.getMessageDetails('message-auth-results-pass');
    expect(valid.senderAuthentication?.author.authorization).toBe('confirmation_required');
  });

  it('rejects forged Gmail authserv identifiers and missing receiver results at ingestion', async () => {
    const adapter = new SharedGmailAdapter(providerConfig);
    messageGetMock.mockResolvedValueOnce({ data: { id: 'message-forged-authserv', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'Agent <agent@msp.test>' },
      { name: 'Authentication-Results', value: 'attacker.test; dmarc=pass header.from=msp.test' },
      { name: 'Authentication-Results', value: 'mx.google.com; dmarc=pass header.from=msp.test' },
    ] } } });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: agent@msp.test\r\n\r\nreply').toString('base64url') } });
    const forged = await adapter.getMessageDetails('message-forged-authserv');
    expect(forged.senderAuthentication?.author.authorization).toBe('confirmation_required');

    messageGetMock.mockResolvedValueOnce({ data: { id: 'message-no-auth', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'Agent <agent@msp.test>' },
      { name: 'Authentication-Results', value: 'attacker.test; dmarc=pass header.from=msp.test' },
    ] } } });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: agent@msp.test\r\n\r\nreply').toString('base64url') } });
    const missing = await adapter.getMessageDetails('message-no-auth');
    expect(missing.senderAuthentication?.author.authorization).toBe('confirmation_required');

    messageGetMock.mockResolvedValueOnce({ data: { id: 'message-missing-receiver', labelIds: ['INBOX'], payload: { headers: [
      { name: 'From', value: 'Agent <agent@msp.test>' },
    ] } } });
    messageGetMock.mockResolvedValueOnce({ data: { raw: Buffer.from('From: agent@msp.test\r\n\r\nreply').toString('base64url') } });
    const noEvidence = await adapter.getMessageDetails('message-missing-receiver');
    expect(noEvidence.senderAuthentication?.author.authorization).toBe('confirmation_required');
  });
});
