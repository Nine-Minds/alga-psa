import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  assertPublicHttpsUrl: vi.fn(),
  postSafeOutboundForm: vi.fn(),
  getTenantSecret: vi.fn(),
  update: vi.fn(),
}));

vi.mock('@alga-psa/core/net/safeFetch', () => ({
  assertPublicHttpsUrl: mocks.assertPublicHttpsUrl,
  postSafeOutboundForm: mocks.postSafeOutboundForm,
}));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: mocks.getTenantSecret }),
}));
vi.mock('@alga-psa/db', () => ({
  tenantDb: () => ({ table: () => ({ where: () => ({ update: mocks.update }) }) }),
}));

import { refreshImapAccessToken } from '@alga-psa/shared/services/email/imapOauthToken';

describe('refreshImapAccessToken', () => {
  const provider = {
    id: 'provider-a', tenant: 'tenant-a',
    oauth_token_url: 'https://idp.example.test/token', oauth_client_id: 'client-a',
    refresh_token: null,
  };
  const db = { fn: { now: () => 'NOW' } } as any;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.assertPublicHttpsUrl.mockResolvedValue(undefined);
    mocks.getTenantSecret.mockImplementation(async (_tenant: string, name: string) =>
      name.includes('client_secret') ? 'client-secret' : 'refresh-secret');
    mocks.postSafeOutboundForm.mockResolvedValue({
      status: 200, data: { access_token: 'access-token', expires_in: 1200 },
    });
    mocks.update.mockResolvedValue(1);
  });

  it('rejects an unsafe legacy URL before reading credentials or posting', async () => {
    mocks.assertPublicHttpsUrl.mockRejectedValue(new Error('unsafe destination'));
    await expect(refreshImapAccessToken({ provider: { ...provider, oauth_token_url: 'http://127.0.0.1/token' }, db }))
      .rejects.toThrow('unsafe destination');
    expect(mocks.getTenantSecret).not.toHaveBeenCalled();
    expect(mocks.postSafeOutboundForm).not.toHaveBeenCalled();
  });

  it('sends refresh credentials through the shared safe form request and persists the token', async () => {
    const mutableProvider = { ...provider };
    const token = await refreshImapAccessToken({ provider: mutableProvider, db });
    expect(token).toBe('access-token');
    expect(mocks.assertPublicHttpsUrl).toHaveBeenCalledWith(provider.oauth_token_url);
    expect(mocks.postSafeOutboundForm).toHaveBeenCalledTimes(1);
    expect(mocks.postSafeOutboundForm.mock.calls[0][0]).toBe(provider.oauth_token_url);
    expect(mocks.postSafeOutboundForm.mock.calls[0][1].get('refresh_token')).toBe('refresh-secret');
    expect(mocks.postSafeOutboundForm.mock.calls[0][1].get('client_secret')).toBe('client-secret');
    expect(mutableProvider.access_token).toBe('access-token');
    expect(mocks.update).toHaveBeenCalledTimes(1);
  });

  it('sanitizes transport errors instead of propagating response or request details', async () => {
    mocks.postSafeOutboundForm.mockRejectedValue(new Error('client_secret=super-secret response-body'));
    await expect(refreshImapAccessToken({ provider: { ...provider }, db }))
      .rejects.toThrow('IMAP OAuth token refresh failed');
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
