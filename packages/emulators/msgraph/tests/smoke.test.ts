import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator from '../src/index';

/**
 * Parity port of test-harness/graph-emulator/smoke.test.mjs, driven through
 * the emulator host and its generated control API instead of /__control.
 */

let host: EmulatorHost;
let base: string;
let control: string;
let webhook: http.Server;
let webhookPort: number;
const notifications: any[] = [];

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

function form(entries: Record<string, string>): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(entries),
  };
}

beforeAll(async () => {
  webhook = http
    .createServer(async (req, res) => {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      if (url.searchParams.has('validationToken')) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end(url.searchParams.get('validationToken'));
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      notifications.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(202);
      res.end();
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => webhook.once('listening', resolve));
  webhookPort = (webhook.address() as { port: number }).port;

  host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.msgraph}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host.stop();
  await new Promise((resolve) => webhook.close(resolve));
});

// Tests narrate one protocol session (token minted early, reused later);
// opt out of the server suite's intra-file shuffle.
describe('msgraph emulator', { shuffle: false }, () => {
  let accessToken: string;
  let refreshToken: string;

  it('pins refresh tokens to the issuing client (smoke parity)', async () => {
    for (const [clientId, clientSecret] of [
      ['premise-app', 'premise-secret'],
      ['other-app', 'other-secret'],
    ]) {
      const seeded = await controlPost('/control/msgraph/seed/client', { clientId, clientSecret });
      expect(seeded.ok).toBe(true);
    }

    const redirectUri = 'http://localhost/callback';
    const authorize = new URL(`${base}/common/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({ client_id: 'premise-app', redirect_uri: redirectUri, state: 'st' }).toString();
    const authResponse = await fetch(authorize, { redirect: 'manual' });
    expect(authResponse.status).toBe(302);
    const location = new URL(authResponse.headers.get('location')!);
    expect(location.searchParams.get('state')).toBe('st');
    const code = location.searchParams.get('code')!;

    const tokenResponse = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({ client_id: 'premise-app', client_secret: 'premise-secret', code, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    expect(tokens.refresh_token).toBeTruthy();

    const wrongClient = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({ client_id: 'other-app', client_secret: 'other-secret', refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    );
    expect(wrongClient.status).toBe(400);

    const refreshed = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({ client_id: 'premise-app', client_secret: 'premise-secret', refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    );
    expect(refreshed.status).toBe(200);
    const refreshedTokens = await refreshed.json();
    accessToken = refreshedTokens.access_token;
    refreshToken = refreshedTokens.refresh_token;
  });

  it('lists mail, validates subscriptions, and pushes notifications (smoke parity)', async () => {
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

    const subscription = await fetch(`${base}/v1.0/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: `http://127.0.0.1:${webhookPort}/webhook`,
        resource: '/me/mailFolders/inbox/messages',
        expirationDateTime: new Date(Date.now() + 3_600_000).toISOString(),
        clientState: 'secret-state',
      }),
    });
    expect(subscription.status).toBe(201);

    const badSubscription = await fetch(`${base}/v1.0/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        changeType: 'created',
        notificationUrl: `http://127.0.0.1:1/unreachable`,
        resource: '/me/mailFolders/inbox/messages',
        expirationDateTime: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    expect(badSubscription.status).toBe(400);

    const seeded = await controlPost('/control/msgraph/seed/message', { subject: 'Backfill me' });
    expect(seeded.ok).toBe(true);
    const message = seeded.result;

    const filter = encodeURIComponent(`receivedDateTime ge ${new Date(Date.now() - 60_000).toISOString()}`);
    const listed = await fetch(`${base}/v1.0/me/mailFolders/inbox/messages?%24filter=${filter}`, { headers });
    expect(((await listed.json()) as any).value[0].id).toBe(message.id);

    const raw = await fetch(`${base}/v1.0/me/messages/${message.id}/$value`, { headers });
    expect(raw.headers.get('content-type')).toContain('message/rfc822');
    expect(await raw.text()).toContain('Subject: Backfill me');

    expect(notifications[0].value[0].resourceData.id).toBe(message.id);
    expect(notifications[0].value[0].clientState).toBe('secret-state');
  });

  it('serves seedable Entra organization and directory user collections', async () => {
    const organization = await controlPost('/control/msgraph/seed/organization', {
      id: 'tenant-contoso',
      displayName: 'Contoso MSP',
      primaryDomain: 'contoso.example',
    });
    expect(organization.ok).toBe(true);

    const directoryUser = await controlPost('/control/msgraph/seed/directory-user', {
      id: 'user-ada',
      displayName: 'Ada Lovelace',
      givenName: 'Ada',
      surname: 'Lovelace',
      mail: 'ada@contoso.example',
      userPrincipalName: 'ada@contoso.example',
      accountEnabled: true,
      jobTitle: 'Engineer',
      businessPhones: ['+1 555 0100'],
    });
    expect(directoryUser.ok).toBe(true);

    const headers = { authorization: `Bearer ${accessToken}` };
    const organizations = await (await fetch(`${base}/v1.0/organization`, { headers })).json();
    expect(organizations.value).toEqual([
      expect.objectContaining({
        id: 'tenant-contoso',
        displayName: 'Contoso MSP',
        verifiedDomains: expect.arrayContaining([
          expect.objectContaining({ name: 'contoso.example', isDefault: true }),
        ]),
      }),
    ]);

    const users = await (await fetch(`${base}/v1.0/users`, { headers })).json();
    expect(users.value).toEqual([
      expect.objectContaining({
        id: 'user-ada',
        mail: 'ada@contoso.example',
        accountEnabled: true,
      }),
    ]);
  });

  it('injects operation faults that expire after N uses', async () => {
    await controlPost('/control/msgraph/faults/operation-fault/arm', {
      operation: 'GET /me',
      status: 503,
      remaining: 1,
    });
    const headers = { authorization: `Bearer ${accessToken}` };
    expect((await fetch(`${base}/v1.0/me`, { headers })).status).toBe(503);
    expect((await fetch(`${base}/v1.0/me`, { headers })).status).toBe(200);
  });

  it('expires access tokens via action and via the virtual clock', async () => {
    await controlPost('/control/msgraph/actions/expire-access-tokens');
    expect((await fetch(`${base}/v1.0/me`, { headers: { authorization: `Bearer ${accessToken}` } })).status).toBe(401);

    const refreshed = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({ client_id: 'premise-app', client_secret: 'premise-secret', refresh_token: refreshToken, grant_type: 'refresh_token' }),
    );
    const tokens = await refreshed.json();
    expect((await fetch(`${base}/v1.0/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(200);

    await controlPost('/control/clock/advance', { duration: '2h' });
    expect((await fetch(`${base}/v1.0/me`, { headers: { authorization: `Bearer ${tokens.access_token}` } })).status).toBe(401);
  });

  it('revokes refresh tokens via action', async () => {
    const authorize = new URL(`${base}/common/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({ client_id: 'premise-app', redirect_uri: 'http://localhost/cb' }).toString();
    const code = new URL((await fetch(authorize, { redirect: 'manual' })).headers.get('location')!).searchParams.get('code')!;
    const tokens = await (
      await fetch(
        `${base}/common/oauth2/v2.0/token`,
        form({ client_id: 'premise-app', client_secret: 'premise-secret', code, redirect_uri: 'http://localhost/cb', grant_type: 'authorization_code' }),
      )
    ).json();

    await controlPost('/control/msgraph/actions/revoke-refresh-token', { refreshToken: tokens.refresh_token });
    const refused = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({ client_id: 'premise-app', client_secret: 'premise-secret', refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).error).toBe('invalid_grant');
  });
});
