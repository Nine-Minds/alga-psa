import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

function makeAdapter() {
  return new MicrosoftGraphAdapter({
    id: 'provider-1',
    tenant: 'tenant-1',
    name: 'Support',
    provider_type: 'microsoft',
    mailbox: 'support+desk@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: '',
    connection_status: 'connected',
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    provider_config: {
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
}

describe('MicrosoftGraphAdapter.sendMail', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('sends through the URL-encoded configured shared mailbox and saves to Sent Items', async () => {
    const adapter = makeAdapter();
    const post = vi.fn(async () => ({
      headers: { 'request-id': 'request-1', 'client-request-id': 'client-request-1' },
    }));
    (adapter as any).httpClient = { post };

    const result = await adapter.sendMail({ kind: 'json', message: { subject: 'Hello' } });

    expect(post).toHaveBeenCalledWith('/users/support%2Bdesk%40example.com/sendMail', {
      message: { subject: 'Hello' },
      saveToSentItems: true,
    });
    expect(result).toEqual({ requestId: 'request-1', clientRequestId: 'client-request-1' });
  });

  it('sends through /me when the configured mailbox matches the authenticated user', async () => {
    const adapter = makeAdapter();
    (adapter as any).authenticatedUserEmail = ' SUPPORT+DESK@example.com ';
    const post = vi.fn(async () => ({ headers: { 'request-id': 'request-me' } }));
    (adapter as any).httpClient = { post };

    await adapter.sendMail({ kind: 'json', message: { subject: 'Personal mailbox' } });

    expect(post).toHaveBeenCalledWith('/me/sendMail', {
      message: { subject: 'Personal mailbox' },
      saveToSentItems: true,
    });
  });

  it('rejects a send when no configured mailbox is available', async () => {
    const adapter = makeAdapter();
    (adapter as any).config.mailbox = '   ';

    await expect(adapter.sendMail({ kind: 'json', message: { subject: 'Missing mailbox' } }))
      .rejects.toThrow('Microsoft sending mailbox is not configured');
  });

  it('refreshes and retries exactly once after a 401', async () => {
    const adapter = makeAdapter();
    const unauthorized = Object.assign(new Error('Unauthorized'), { response: { status: 401 } });
    const post = vi.fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({ headers: { 'request-id': 'request-2' } });
    const refresh = vi.spyOn(adapter as any, 'refreshAccessToken').mockResolvedValue(undefined);
    (adapter as any).httpClient = { post };

    await expect(adapter.sendMail({ kind: 'json', message: { subject: 'Retry' } }))
      .resolves.toEqual({ requestId: 'request-2' });
    expect(refresh).toHaveBeenCalledOnce();
    expect(post).toHaveBeenCalledTimes(2);
  });

  it('sends MIME content with the Graph-required content type', async () => {
    const adapter = makeAdapter();
    const post = vi.fn(async () => ({ headers: { 'request-id': 'request-mime' } }));
    (adapter as any).httpClient = { post };

    await adapter.sendMail({ kind: 'mime', content: 'base64-mime-content' });

    expect(post).toHaveBeenCalledWith(
      '/users/support%2Bdesk%40example.com/sendMail',
      'base64-mime-content',
      { headers: { 'Content-Type': 'text/plain' } }
    );
  });

  it('does not expose request credentials or message bodies when a send fails', async () => {
    const adapter = makeAdapter();
    const post = vi.fn().mockRejectedValue({
      message: 'Forbidden',
      config: {
        headers: { Authorization: 'Bearer secret-access-token' },
        data: 'secret-message-body',
      },
      response: {
        status: 403,
        data: { error: { code: 'ErrorAccessDenied', message: 'Forbidden' } },
        headers: { 'request-id': 'safe-request-id' },
      },
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (adapter as any).httpClient = { post };

    await expect(adapter.sendMail({ kind: 'json', message: { subject: 'Private' } }))
      .rejects.toMatchObject({
        status: 403,
        code: 'ErrorAccessDenied',
        requestId: 'safe-request-id',
      });

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain('secret-access-token');
    expect(logged).not.toContain('secret-message-body');
  });
});

describe('MicrosoftGraphAdapter.testConnection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('reads only mail data for shared mailboxes, never the mailbox user object', async () => {
    // GET /users/{mailbox} needs User.Read.All, which the email OAuth scopes
    // do not include; reading it made every shared-mailbox connection test
    // fail with 403 under the platform Microsoft app.
    const adapter = makeAdapter();
    (adapter as any).authenticatedUserEmail = 'owner@example.com';
    const get = vi.fn(async () => ({ data: {} }));
    (adapter as any).httpClient = { get };

    const result = await adapter.testConnection();

    expect(result).toEqual({ success: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/users/support%2Bdesk%40example.com/mailFolders', {
      params: { $top: 1, $select: 'id' },
    });
  });

  it('surfaces the Graph status, error code, and request id on failure', async () => {
    const adapter = makeAdapter();
    (adapter as any).authenticatedUserEmail = 'owner@example.com';
    const get = vi.fn().mockRejectedValue({
      message: 'Request failed with status code 403',
      response: {
        status: 403,
        data: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } },
        headers: { 'request-id': 'graph-request-1' },
      },
    });
    (adapter as any).httpClient = { get };

    const result = await adapter.testConnection();

    expect(result.success).toBe(false);
    expect(result.error).toBe('Access is denied. (403 ErrorAccessDenied request-id=graph-request-1)');
  });
});

describe('MicrosoftGraphAdapter.connect', () => {
  it('does not report a failed Graph health check as connected', async () => {
    const adapter = makeAdapter();
    vi.spyOn(adapter as any, 'loadCredentials').mockResolvedValue(undefined);
    vi.spyOn(adapter as any, 'loadAuthenticatedUserEmail').mockResolvedValue(undefined);
    vi.spyOn(adapter, 'testConnection').mockResolvedValue({
      success: false,
      error: 'Mailbox unavailable',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(adapter.connect()).rejects.toThrow('Mailbox unavailable');
  });
});
