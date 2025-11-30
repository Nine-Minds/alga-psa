import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GmailAdapter } from '../../../services/email/providers/GmailAdapter';
import { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const historyListMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        history: {
          list: historyListMock
        }
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
});
