import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator from '../src/index';

/**
 * Microsoft Graph simulator smoke coverage. It proves the adapter's request
 * shape only; a real tenant send still requires delegated Mail.Send.Shared,
 * reauthorization, and Exchange Send As permission.
 */
let host: EmulatorHost;
let graphBaseUrl: string;
let controlUrl: string;

async function controlPost(path: string, body: unknown): Promise<any> {
  const response = await fetch(`${controlUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return response.json();
}

async function mintAccessToken(): Promise<string> {
  const clientId = `mail-send-smoke-${Math.random().toString(36).slice(2)}`;
  const clientSecret = 'mail-send-smoke-secret';
  expect((await controlPost('/control/msgraph/seed/client', { clientId, clientSecret })).ok).toBe(true);

  const redirectUri = 'http://localhost/mail-send-smoke-callback';
  const authorize = new URL(`${graphBaseUrl.replace('/v1.0', '')}/common/oauth2/v2.0/authorize`);
  authorize.search = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, scope: 'Mail.Send User.Read' }).toString();
  const authorization = await fetch(authorize, { redirect: 'manual' });
  const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
  const token = await fetch(`${graphBaseUrl.replace('/v1.0', '')}/common/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  return (await token.json()).access_token;
}

async function adapterFor(mailbox: string) {
  process.env.MICROSOFT_GRAPH_BASE_URL = graphBaseUrl;
  const { MicrosoftGraphAdapter } = await import('../../../../shared/services/email/providers/MicrosoftGraphAdapter');
  const accessToken = await mintAccessToken();
  return new MicrosoftGraphAdapter({
    id: `provider-${mailbox}`,
    tenant: 'tenant-mail-send-smoke',
    name: 'Microsoft Graph simulator smoke',
    provider_type: 'microsoft',
    mailbox,
    folder_to_monitor: 'Inbox',
    active: true,
    webhook_notification_url: '',
    connection_status: 'connected',
    created_at: '2026-08-28T00:00:00.000Z',
    updated_at: '2026-08-28T00:00:00.000Z',
    provider_config: {
      access_token: accessToken,
      refresh_token: 'unused-in-smoke',
      token_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    },
  });
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
  const { controlPort, ports } = await host.start();
  graphBaseUrl = `http://127.0.0.1:${ports.msgraph}/v1.0`;
  controlUrl = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  delete process.env.MICROSOFT_GRAPH_BASE_URL;
  await host.stop();
});

describe('MicrosoftGraphAdapter Graph simulator sendMail smoke', { shuffle: false }, () => {
  it('uses /me/sendMail for the authenticated mailbox and records the expected payload', async () => {
    const adapter = await adapterFor('support@example.test');
    await adapter.connect();
    await adapter.sendMail({ kind: 'json', message: { subject: 'Personal mailbox send', toRecipients: [] } });

    const sends = (await (await fetch(`${controlUrl}/control/msgraph/state/send-mails`)).json()).result;
    expect(sends.at(-1)).toMatchObject({
      route: '/v1.0/me/sendMail',
      mailbox: null,
      payload: { message: { subject: 'Personal mailbox send', toRecipients: [] }, saveToSentItems: true },
    });
  });

  it('uses the encoded /users/{mailbox}/sendMail route for a shared mailbox and records the expected payload', async () => {
    const adapter = await adapterFor('support+desk@example.com');
    await adapter.connect();
    await adapter.sendMail({ kind: 'json', message: { subject: 'Shared mailbox send', toRecipients: [] } });

    const sends = (await (await fetch(`${controlUrl}/control/msgraph/state/send-mails`)).json()).result;
    expect(sends.at(-1)).toMatchObject({
      route: '/v1.0/users/support%2Bdesk%40example.com/sendMail',
      mailbox: 'support+desk@example.com',
      encodedMailbox: 'support%2Bdesk%40example.com',
      payload: { message: { subject: 'Shared mailbox send', toRecipients: [] }, saveToSentItems: true },
    });
  });
});
