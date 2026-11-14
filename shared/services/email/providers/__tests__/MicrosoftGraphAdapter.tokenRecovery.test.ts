import { afterEach, describe, expect, it, vi } from 'vitest';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

// The browser journey expires the Graph token behind the adapter's back and the
// first outbound send then has to connect() through a bearer the stored expiry
// still calls live. Before the response interceptor only sendMail recovered a
// 401, so the /me probe inside connect() failed the whole provider
// (production-regression run 41339450110, browser-2 community).

function makeAdapter(expiresInMs = 60 * 60 * 1000) {
  return new MicrosoftGraphAdapter({
    id: 'provider-1', tenant: 'tenant-1', name: 'Support', provider_type: 'microsoft',
    mailbox: 'support@example.com', folder_to_monitor: 'Inbox', active: true, webhook_notification_url: '',
    connection_status: 'connected', created_at: '2026-08-01T00:00:00.000Z', updated_at: '2026-08-01T00:00:00.000Z',
    provider_config: { access_token: 'stale-token', refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() + expiresInMs).toISOString() },
  });
}

const unauthorized = (config: InternalAxiosRequestConfig) => new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, null,
  { status: 401, statusText: 'Unauthorized', headers: {}, config,
    data: { error: { code: 'InvalidAuthenticationToken', message: 'Access token is expired or invalid' } } });

type Call = { url: string; bearer: string };

/** Graph that rejects every bearer except the refreshed one. */
function graphAcceptingOnly(adapter: MicrosoftGraphAdapter, liveToken: string) {
  const calls: Call[] = [];
  (adapter as any).httpClient.defaults.adapter = async (config: InternalAxiosRequestConfig) => {
    const bearer = String(config.headers.Authorization);
    calls.push({ url: String(config.url), bearer });
    if (bearer !== `Bearer ${liveToken}`) throw unauthorized(config);
    const data = String(config.url) === '/me'
      ? { userPrincipalName: 'support@example.com', mail: 'support@example.com' }
      : { id: 'inbox', value: [] };
    return { data, status: 200, statusText: 'OK', headers: {}, config };
  };
  return calls;
}

describe('MicrosoftGraphAdapter token recovery', () => {
  afterEach(() => vi.restoreAllMocks());

  it('connect() refreshes and replays when Graph rejects a bearer the stored expiry still calls live', async () => {
    const adapter = makeAdapter();
    const calls = graphAcceptingOnly(adapter, 'fresh-token');
    const refresh = vi.spyOn(adapter as any, 'refreshAccessToken').mockImplementation(async () => {
      (adapter as any).accessToken = 'fresh-token';
      (adapter as any).tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await expect(adapter.connect()).resolves.toBeUndefined();
    expect(refresh).toHaveBeenCalledOnce();
    expect(calls.slice(0, 2)).toEqual([
      { url: '/me', bearer: 'Bearer stale-token' },
      { url: '/me', bearer: 'Bearer fresh-token' },
    ]);
    // Every later probe already carries the refreshed bearer; nothing is replayed twice.
    expect(calls.slice(2).every(call => call.bearer === 'Bearer fresh-token')).toBe(true);
  });

  it('parallel requests that all meet a 401 share one refresh', async () => {
    const adapter = makeAdapter();
    const calls = graphAcceptingOnly(adapter, 'fresh-token');
    let resolveRefresh!: () => void;
    const refresh = vi.spyOn(adapter as any, 'refreshAccessToken').mockImplementation(() => new Promise<void>(resolve => {
      resolveRefresh = () => { (adapter as any).accessToken = 'fresh-token'; resolve(); };
    }));
    (adapter as any).accessToken = 'stale-token';
    (adapter as any).tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000);

    const client = (adapter as any).httpClient;
    const inFlight = Promise.all([client.get('/me'), client.get('/users/support%40example.com/mailFolders/inbox')]);
    await vi.waitFor(() => expect(calls).toHaveLength(2));
    expect(refresh).toHaveBeenCalledOnce();
    resolveRefresh();
    await inFlight;
    expect(calls.map(call => call.bearer)).toEqual(['Bearer stale-token', 'Bearer stale-token', 'Bearer fresh-token', 'Bearer fresh-token']);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('a failed refresh surfaces instead of the replay, and the next request may try again', async () => {
    const adapter = makeAdapter();
    graphAcceptingOnly(adapter, 'never-issued');
    const refresh = vi.spyOn(adapter as any, 'refreshAccessToken')
      .mockRejectedValueOnce(Object.assign(new Error('refresh grant rejected'), { microsoftOAuthFailureKind: 'consent_revoked' }))
      .mockResolvedValueOnce(undefined);
    const client = (adapter as any).httpClient;

    await expect(client.get('/me')).rejects.toMatchObject({ message: 'refresh grant rejected', microsoftOAuthFailureKind: 'consent_revoked' });
    await expect(client.get('/me')).rejects.toMatchObject({ response: { status: 401 } });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('a stored expiry in the past still refreshes before the first request, without a 401 round trip', async () => {
    const adapter = makeAdapter(-1);
    const calls = graphAcceptingOnly(adapter, 'fresh-token');
    const refresh = vi.spyOn(adapter as any, 'refreshAccessToken').mockImplementation(async () => {
      (adapter as any).accessToken = 'fresh-token';
      (adapter as any).tokenExpiresAt = new Date(Date.now() + 55 * 60 * 1000);
    });
    vi.spyOn(console, 'info').mockImplementation(() => undefined);

    await adapter.connect();
    expect(refresh).toHaveBeenCalledOnce();
    expect(calls[0]).toEqual({ url: '/me', bearer: 'Bearer fresh-token' });
  });
});
