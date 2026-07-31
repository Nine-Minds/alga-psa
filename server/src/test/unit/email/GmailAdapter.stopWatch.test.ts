import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmailProviderConfig } from '@alga-psa/shared/interfaces/inbound-email.interfaces';

const stopMock = vi.fn();

vi.mock('googleapis', () => ({
  google: {
    gmail: vi.fn(() => ({
      users: {
        stop: stopMock,
      },
    })),
  },
}));

import { GmailAdapter } from '@alga-psa/shared/services/email/providers/GmailAdapter';

const config: EmailProviderConfig = {
  id: 'provider-google-1',
  tenant: 'tenant-1',
  name: 'Support',
  provider_type: 'google',
  mailbox: 'support@example.com',
  folder_to_monitor: 'Inbox',
  active: true,
  webhook_notification_url: 'https://example.test/api/email/webhooks/google',
  connection_status: 'connected',
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  provider_config: {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    token_expires_at: new Date(Date.now() + 60_000).toISOString(),
  },
};

describe('GmailAdapter.stopWatch', () => {
  beforeEach(() => {
    stopMock.mockReset();
  });

  it('T015: issues users.stop for the configured account', async () => {
    stopMock.mockResolvedValue({ status: 204 });
    const adapter = new GmailAdapter(config);
    (adapter as any).accessToken = 'access-token';
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60_000);

    await expect(adapter.stopWatch()).resolves.toBeUndefined();
    expect(stopMock).toHaveBeenCalledWith({ userId: 'me' });
  });

  it('T016: wraps Gmail API failures for the best-effort caller', async () => {
    stopMock.mockRejectedValue(new Error('revoked consent'));
    const adapter = new GmailAdapter(config);
    (adapter as any).accessToken = 'access-token';
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60_000);

    await expect(adapter.stopWatch()).rejects.toThrow('Error in stopWatch: revoked consent');
  });
});
