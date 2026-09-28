import { describe, it, expect, vi } from 'vitest';
import axios from 'axios';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';
import { runMicrosoftOAuthCallbackDiagnostic } from '../../microsoftOAuthCallbackDiagnostic';

function makeJwt(payload: Record<string, any>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeAdapter(overrides?: Partial<any>, adapterOptions?: { persistRefreshedCredentials?: boolean }) {
  const config: any = {
    id: 'provider-1',
    tenant: 'tenant-1',
    name: 'Provider',
    provider_type: 'microsoft',
    mailbox: 'support@example.com',
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: 'https://example.com/api/email/webhooks/microsoft',
    connection_status: 'connected',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    provider_config: {
      access_token: makeJwt({ tid: 'tid', scp: 'Mail.Read Mail.Read.Shared', aud: 'graph' }),
      refresh_token: 'refresh-token',
      client_secret: 'client-secret-value',
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    ...overrides,
  };

  const adapter = new MicrosoftGraphAdapter(config, adapterOptions);

  const get = async (path: string) => {
    if (path === '/me') {
      return {
        status: 200,
        data: { id: 'me-id', userPrincipalName: 'admin@example.com', mail: 'admin@example.com' },
        headers: { 'request-id': 'rid-me', 'client-request-id': 'cid-me' },
      };
    }
    if (path.startsWith('/users/')) {
      return {
        status: 200,
        data: { id: 'user-id', userPrincipalName: 'support@example.com', mail: 'support@example.com' },
        headers: { 'request-id': 'rid-user', 'client-request-id': 'cid-user' },
      };
    }
    if (path.endsWith('/mailFolders/inbox')) {
      return {
        status: 200,
        data: { id: 'inbox-id', displayName: 'Inbox' },
        headers: { 'request-id': 'rid-inbox', 'client-request-id': 'cid-inbox' },
      };
    }
    if (path.endsWith('/mailFolders')) {
      return {
        status: 200,
        data: { value: [{ id: 'inbox-id', displayName: 'Inbox' }] },
        headers: { 'request-id': 'rid-folders', 'client-request-id': 'cid-folders' },
      };
    }
    if (path.endsWith('/mailFolders/inbox/messages')) {
      return {
        status: 200,
        data: { value: [{ id: 'm1', subject: 'Hello', receivedDateTime: new Date().toISOString() }] },
        headers: { 'request-id': 'rid-msg', 'client-request-id': 'cid-msg' },
      };
    }
    throw new Error(`Unexpected GET ${path}`);
  };

  const post = async (path: string) => {
    if (path === '/subscriptions') {
      return {
        status: 201,
        data: { id: 'sub-1', expirationDateTime: new Date(Date.now() + 10_000).toISOString() },
        headers: { 'request-id': 'rid-sub', 'client-request-id': 'cid-sub' },
      };
    }
    throw new Error(`Unexpected POST ${path}`);
  };

  const del = async (path: string) => {
    if (path.startsWith('/subscriptions/')) {
      return {
        status: 204,
        data: {},
        headers: { 'request-id': 'rid-del', 'client-request-id': 'cid-del' },
      };
    }
    throw new Error(`Unexpected DELETE ${path}`);
  };

  (adapter as any).httpClient = { get, post, delete: del };
  return adapter;
}

describe('MicrosoftGraphAdapter.runMicrosoft365Diagnostics', () => {
  it('returns a successful report with a live subscription test', async () => {
    const adapter = makeAdapter();
    const report = await adapter.runMicrosoft365Diagnostics({
      includeIdentifiers: true,
      liveSubscriptionTest: true,
      requiredScopes: ['Mail.Read', 'Mail.Read.Shared'],
    });

    expect(report.summary.overallStatus).toBe('pass');
    expect(report.summary.targetResource).toContain('/mailFolders/inbox/messages');

    const tokenStep = report.steps.find((s) => s.id === 'tokens_present');
    expect(tokenStep?.status).toBe('pass');
    expect((tokenStep?.data as any)?.accessToken).toMatch(/^eyJ.+\.\.\.\(\d+\)$/);

    const subStep = report.steps.find((s) => s.id === 'subscription_live_test');
    expect(subStep?.status).toBe('pass');
    expect((subStep?.data as any)?.createdSubscriptionId).toBe('sub-1');
    expect((subStep?.data as any)?.deletedSubscriptionId).toBe('sub-1');

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain('refresh-token');
    expect(serialized).not.toContain('Authorization');
    expect(serialized).not.toContain('client-secret-value');
    expect(serialized).not.toContain(makeJwt({ tid: 'tid', scp: 'Mail.Read Mail.Read.Shared', aud: 'graph' }));
  });


  it('warns when delegated scopes are missing', async () => {
    const adapter = makeAdapter({
      provider_config: {
        access_token: makeJwt({ tid: 'tid', scp: 'Mail.Read', aud: 'graph' }),
        refresh_token: 'refresh-token',
      },
    });

    const report = await adapter.runMicrosoft365Diagnostics({
      includeIdentifiers: true,
      liveSubscriptionTest: false,
      requiredScopes: ['Mail.Read', 'Mail.Read.Shared'],
    });

    const claimsStep = report.steps.find((s) => s.id === 'token_claims');
    expect(claimsStep?.status).toBe('warn');
    expect(report.recommendations.join('\n')).toContain('Mail.Read.Shared');
  });

  it('warns on unavailable mailbox directory and root listing while Inbox succeeds', async () => {
    const adapter = makeAdapter();
    (adapter as any).httpClient = {
      get: async (path: string) => {
        if (path === '/me') return { status: 200, data: { id: 'me', userPrincipalName: 'admin@example.com' }, headers: {} };
        if (path === '/users/support%40example.com') throw {
          config: { url: path }, response: { status: 404, headers: { 'request-id': 'rid-directory' }, data: { error: { code: 'ErrorItemNotFound', message: 'Not found' } } },
        };
        if (path === '/users/support%40example.com/mailFolders/inbox') return { status: 200, data: { id: 'inbox-id', displayName: 'Inbox' }, headers: { 'request-id': 'rid-inbox' } };
        if (path === '/users/support%40example.com/mailFolders') throw {
          config: { url: path }, response: { status: 404, headers: { 'request-id': 'rid-root' }, data: { error: { code: 'ErrorItemNotFound', message: 'Default folder Root not found' } } },
        };
        if (path === '/users/support%40example.com/mailFolders/inbox/messages') return { status: 200, data: { value: [] }, headers: {} };
        throw new Error(`Unexpected GET ${path}`);
      },
    };

    const report = await adapter.runMicrosoft365Diagnostics({ includeIdentifiers: true, liveSubscriptionTest: false });
    const directory = report.steps.find((step) => step.id === 'mailbox_directory');
    const root = report.steps.find((step) => step.id === 'folder_list');
    const inbox = report.steps.find((step) => step.id === 'inbox_well_known');
    expect(directory).toMatchObject({ status: 'warn', http: { status: 404, requestId: 'rid-directory' } });
    expect(root).toMatchObject({ status: 'warn', http: { status: 404, requestId: 'rid-root' } });
    expect(inbox?.status).toBe('pass');
    expect(report.recommendations.join('\n')).not.toContain('Root folder listing');
  });

  it('returns raw MIME bytes from downloadMessageSource', async () => {
    const adapter = makeAdapter();
    (adapter as any).httpClient = {
      get: async (path: string) => {
        if (path.endsWith('/$value')) {
          return { data: Buffer.from('From: sender@example.com\r\n\r\nhello', 'utf8') };
        }
        throw new Error(`Unexpected GET ${path}`);
      },
    };

    const buffer = await adapter.downloadMessageSource('message-1');
    expect(buffer.toString('utf8')).toContain('From: sender@example.com');
  });

  it('does not persist a token refresh during diagnostics when persistence is disabled', async () => {
    const adapter = makeAdapter({
      provider_config: {
        client_id: 'client-id',
        client_secret: 'client-secret-value',
        access_token: makeJwt({ tid: 'tid', scp: 'Mail.Read Mail.Read.Shared', aud: 'graph' }),
        refresh_token: 'refresh-token',
        token_expires_at: new Date(Date.now() - 60_000).toISOString(),
      },
    }, { persistRefreshedCredentials: false });
    const postSpy = vi.spyOn(axios, 'post').mockResolvedValue({
      data: { access_token: 'refreshed-access-token', refresh_token: 'refreshed-refresh-token', expires_in: 3600 },
    } as any);
    const getAdminConnection = await import('../../../../db/admin');
    const dbPackage = await import('@alga-psa/db');
    const adminSpy = vi.spyOn(getAdminConnection, 'getAdminConnection').mockRejectedValue(new Error('DB write must not be attempted'));
    const tenantDbSpy = vi.spyOn(dbPackage, 'tenantDb');
    const originalHttpClient = (adapter as any).httpClient;
    const originalGet = originalHttpClient.get;
    originalHttpClient.get = async (path: string, options?: any) => {
      await (adapter as any).ensureValidToken();
      return originalGet(path, options);
    };

    try {
      const report = await adapter.runMicrosoft365Diagnostics({ includeIdentifiers: true, liveSubscriptionTest: false });
      expect(postSpy).toHaveBeenCalledOnce();
      expect(report.steps.find((step) => step.id === 'tokens_present')?.status).toBe('pass');
      expect(adminSpy).not.toHaveBeenCalled();
      expect(tenantDbSpy).not.toHaveBeenCalled();
    } finally {
      postSpy.mockRestore();
      adminSpy.mockRestore();
      tenantDbSpy.mockRestore();
    }
  });

  it('returns a redacted callback diagnostic envelope using only in-memory tokens', async () => {
    const callbackAccessToken = 'callback-access-token-secret';
    const callbackRefreshToken = 'callback-refresh-token-secret';
    const stored = await runMicrosoftOAuthCallbackDiagnostic({
      provider: {
        id: 'provider-callback', tenant: 'tenant-1', provider_name: 'Support', mailbox: 'support@example.com',
        is_active: true, status: 'error', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      vendorConfig: { client_secret: 'stored-client-secret-value' },
      accessToken: callbackAccessToken,
      refreshToken: callbackRefreshToken,
      expiresAt: new Date(Date.now() + 60_000),
    }, (config) => {
      const adapter = new MicrosoftGraphAdapter(config, { persistRefreshedCredentials: false });
      (adapter as any).httpClient = { get: async (path: string) => {
        if (path === '/me') return { status: 200, data: { id: 'me', userPrincipalName: 'admin@example.com' }, headers: {} };
        if (path === '/users/support%40example.com') return { status: 200, data: { id: 'support' }, headers: {} };
        if (path === '/users/support%40example.com/mailFolders/inbox') return { status: 200, data: { id: 'inbox-id', displayName: 'Inbox' }, headers: {} };
        if (path === '/users/support%40example.com/mailFolders') return { status: 200, data: { value: [{ id: 'inbox-id', displayName: 'Inbox' }] }, headers: {} };
        if (path === '/users/support%40example.com/mailFolders/inbox/messages') return { status: 200, data: { value: [] }, headers: {} };
        throw new Error(`Unexpected GET ${path}`);
      } };
      return adapter;
    });

    expect(stored).toMatchObject({ source: 'oauth_callback', report: { summary: { providerId: 'provider-callback' } } });
    expect(Number.isNaN(Date.parse(stored.createdAt))).toBe(false);
    const serialized = JSON.stringify(stored);
    expect(serialized).not.toContain(callbackAccessToken);
    expect(serialized).not.toContain(callbackRefreshToken);
    expect(serialized).not.toContain('stored-client-secret-value');
    expect(serialized).not.toContain('Authorization');
  });

  it('requests html bodies and preserves html for inline image extraction', async () => {
    const adapter = makeAdapter();
    const get = vi.fn(async (path: string, options?: any) => {
      if (path === '/users/support%40example.com/messages/message-1') {
        return {
          data: {
            id: 'message-1',
            receivedDateTime: '2026-03-31T23:11:12.021Z',
            subject: 'inline image test',
            body: {
              contentType: 'html',
              content: '<p>Hello<img src="cid:inline-image-1" /></p>',
            },
            bodyPreview: 'Hello',
            from: {
              emailAddress: {
                address: 'sender@example.com',
                name: 'Sender',
              },
            },
            toRecipients: [],
            ccRecipients: [],
            conversationId: 'conversation-1',
            internetMessageHeaders: [
              { name: 'x-resolved-original-sender', value: 'victim@example.com' },
              { name: 'X-List-Address', value: 'support@lists.example.com' },
            ],
            attachments: [
              {
                id: 'attachment-1',
                name: 'image.png',
                contentType: 'image/png',
                size: 1234,
                contentId: 'inline-image-1',
                isInline: true,
              },
            ],
          },
        };
      }

      throw new Error(`Unexpected GET ${path} ${JSON.stringify(options || {})}`);
    });

    (adapter as any).httpClient = { get };

    const message = await adapter.getMessageDetails('message-1');

    expect(get).toHaveBeenCalledWith(
      '/users/support%40example.com/messages/message-1',
      expect.objectContaining({
        headers: {
          Prefer: 'outlook.body-content-type="html"',
        },
      })
    );
    expect(message.body.html).toBe('<p>Hello<img src="cid:inline-image-1" /></p>');
    expect(message.body.text).toBe('Hello');
    expect(message.headers).not.toHaveProperty('x-resolved-original-sender');
    expect(message.headers).not.toHaveProperty('X-List-Address');
    expect(message.attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        contentId: 'inline-image-1',
        isInline: true,
      }),
    ]);
  });
});
