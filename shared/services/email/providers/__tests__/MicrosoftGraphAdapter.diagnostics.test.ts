import { describe, it, expect, vi } from 'vitest';
import { MicrosoftGraphAdapter } from '../MicrosoftGraphAdapter';

function makeJwt(payload: Record<string, any>) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.sig`;
}

function makeAdapter(overrides?: Partial<any>) {
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
      token_expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    ...overrides,
  };

  const adapter = new MicrosoftGraphAdapter(config);

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
            internetMessageHeaders: [],
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
    expect(message.attachments).toEqual([
      expect.objectContaining({
        id: 'attachment-1',
        contentId: 'inline-image-1',
        isInline: true,
      }),
    ]);
  });
});
