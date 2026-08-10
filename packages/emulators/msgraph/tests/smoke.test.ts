import http from 'node:http';
import { createLocalJWKSet, jwtVerify } from 'jose';
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
let botEndpoint: http.Server;
let botEndpointUrl: string;
const notifications: any[] = [];
/** Stand-in for the app's /api/teams/bot/messages route. */
const inboundBotRequests: Array<{ authorization: string | null; activity: any }> = [];

const BOT_APP_ID = 'emulated-bot-app-id';

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

async function controlState(view: string): Promise<any> {
  return (await (await fetch(`${control}/control/msgraph/state/${view}`)).json()).result;
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
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
      notifications.push(await readJsonBody(req));
      res.writeHead(202);
      res.end();
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => webhook.once('listening', resolve));
  webhookPort = (webhook.address() as { port: number }).port;

  botEndpoint = http
    .createServer(async (req, res) => {
      if (req.url !== '/api/teams/bot/messages') {
        res.writeHead(404).end();
        return;
      }
      const activity = await readJsonBody(req);
      inboundBotRequests.push({ authorization: req.headers.authorization ?? null, activity });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'message', text: 'ack' }));
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => botEndpoint.once('listening', resolve));
  botEndpointUrl = `http://127.0.0.1:${(botEndpoint.address() as { port: number }).port}/api/teams/bot/messages`;

  host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.msgraph}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  await host.stop();
  await new Promise((resolve) => webhook.close(resolve));
  await new Promise((resolve) => botEndpoint.close(resolve));
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

  it('supports guided Entra application creation and administrator consent', async () => {
    const redirectUri = 'http://localhost/email-setup/callback';
    const authorize = new URL(`${base}/common/oauth2/v2.0/authorize`);
    authorize.search = new URLSearchParams({
      client_id: 'premise-app',
      redirect_uri: redirectUri,
      state: 'setup-state',
      nonce: 'setup-nonce',
      scope: 'https://graph.microsoft.com/Application.ReadWrite.All openid profile email',
    }).toString();
    const authorization = await fetch(authorize, { redirect: 'manual' });
    const code = new URL(authorization.headers.get('location')!).searchParams.get('code')!;
    const tokenResponse = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({
        client_id: 'premise-app',
        client_secret: 'premise-secret',
        code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      })
    );
    const tokens = await tokenResponse.json();
    expect(tokens.access_token.split('.')).toHaveLength(3);
    expect(tokens.id_token.split('.')).toHaveLength(3);

    const headers = {
      authorization: `Bearer ${tokens.access_token}`,
      'content-type': 'application/json',
    };
    const applicationResponse = await fetch(`${base}/v1.0/applications`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        displayName: 'Alga Email',
        signInAudience: 'AzureADMultipleOrgs',
        web: { redirectUris: ['http://localhost/api/auth/microsoft/callback'] },
        requiredResourceAccess: [],
      }),
    });
    expect(applicationResponse.status).toBe(201);
    const application = await applicationResponse.json();

    const servicePrincipalResponse = await fetch(`${base}/v1.0/servicePrincipals`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ appId: application.appId }),
    });
    expect(servicePrincipalResponse.status).toBe(201);

    const passwordResponse = await fetch(`${base}/v1.0/applications/${application.id}/addPassword`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ passwordCredential: { displayName: 'Alga email client secret' } }),
    });
    expect(passwordResponse.status).toBe(200);
    expect((await passwordResponse.json()).secretText).toBeTruthy();

    const consent = new URL(`${base}/11111111-2222-4333-8444-555555555555/v2.0/adminconsent`);
    consent.search = new URLSearchParams({
      client_id: application.appId,
      redirect_uri: redirectUri,
      state: 'consent-state',
    }).toString();
    const consentResponse = await fetch(consent, { redirect: 'manual' });
    const consentCallback = new URL(consentResponse.headers.get('location')!);
    expect(consentCallback.searchParams.get('admin_consent')).toBe('true');
    expect(consentCallback.searchParams.get('state')).toBe('consent-state');
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

  let botToken: string;
  let jwksBeforeReset: unknown;
  const conversationId = 'a:teams-conversation-1';

  it('injects a signed inbound Teams activity into the app bot endpoint', async () => {
    const configured = await controlPost('/control/msgraph/actions/configure', {
      botTargetUrl: botEndpointUrl,
      botServiceUrl: base,
      botAppId: BOT_APP_ID,
    });
    expect(configured.result.bot).toMatchObject({ targetUrl: botEndpointUrl, appId: BOT_APP_ID });

    const guest = await controlPost('/control/msgraph/seed/teams-user', {
      id: 'guest-client-contact',
      displayName: 'Wanda Client',
      mail: 'wanda@client.example',
      userType: 'Guest',
    });
    expect(guest.result).toMatchObject({ userType: 'Guest', externalUserState: 'PendingAcceptance' });
    expect(guest.result.botIdentity.id).toBe('29:guest-client-contact');

    const seeded = await controlPost('/control/msgraph/seed/bot-activity', {
      text: 'My printer is on fire',
      fromAadObjectId: 'guest-client-contact',
      fromName: 'Wanda Client',
      conversationId,
      conversationType: 'personal',
      tenantId: '11111111-2222-4333-8444-555555555555',
    });
    expect(seeded.ok).toBe(true);
    expect(seeded.result).toMatchObject({ delivered: true, status: 200 });
    expect(seeded.result.response).toEqual({ type: 'message', text: 'ack' });

    const received = inboundBotRequests.at(-1)!;
    expect(received.activity).toMatchObject({
      type: 'message',
      channelId: 'msteams',
      serviceUrl: base,
      text: 'My printer is on fire',
      from: { id: '29:guest-client-contact', aadObjectId: 'guest-client-contact', name: 'Wanda Client' },
      conversation: { id: conversationId, conversationType: 'personal' },
      channelData: { tenant: { id: '11111111-2222-4333-8444-555555555555' } },
    });

    // The app verifies this token against the emulator's JWKS with jose, so
    // verify it exactly the way teamsBotJwtVerifier does.
    const config = await (await fetch(`${base}/v1/.well-known/openidconfiguration`)).json();
    expect(config.issuer).toBe('https://api.botframework.com');
    expect(config.jwks_uri).toBe(`${base}/v1/.well-known/keys`);

    const jwksDocument = await (await fetch(config.jwks_uri)).json();
    expect(jwksDocument.keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    expect(jwksDocument.keys[0].kid).toBeTruthy();
    jwksBeforeReset = jwksDocument;

    const { payload } = await jwtVerify(
      received.authorization!.replace(/^Bearer\s+/i, ''),
      createLocalJWKSet(jwksDocument),
      { issuer: config.issuer, audience: BOT_APP_ID },
    );
    expect(payload).toMatchObject({
      serviceurl: base,
      oid: 'guest-client-contact',
      tid: '11111111-2222-4333-8444-555555555555',
    });

    const users = await (
      await fetch(`${base}/v1.0/users`, { headers: { authorization: `Bearer ${accessToken}` } })
    ).json();
    expect(users.value).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'guest-client-contact',
          userType: 'Guest',
          externalUserState: 'PendingAcceptance',
        }),
        expect.objectContaining({ id: 'user-ada', userType: 'Member', externalUserState: null }),
      ]),
    );
  });

  it('captures outbound connector activities including adaptive cards', async () => {
    const tokenResponse = await fetch(
      `${base}/common/oauth2/v2.0/token`,
      form({
        client_id: 'premise-app',
        client_secret: 'premise-secret',
        grant_type: 'client_credentials',
        scope: 'https://api.botframework.com/.default',
      }),
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = await tokenResponse.json();
    expect(tokens.refresh_token).toBeUndefined();
    botToken = tokens.access_token;

    const headers = { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' };
    expect((await fetch(`${base}/v3/conversations/${conversationId}/activities`, { method: 'POST' })).status).toBe(401);

    const created = await fetch(`${base}/v3/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ isGroup: false, members: [{ id: '29:guest-client-contact' }] }),
    });
    expect(created.status).toBe(201);
    expect((await created.json()).id).toBeTruthy();

    const card = {
      contentType: 'application/vnd.microsoft.card.adaptive',
      content: {
        type: 'AdaptiveCard',
        version: '1.5',
        body: [{ type: 'TextBlock', text: 'Ticket TKT-1042 created' }],
      },
    };
    const sent = await fetch(`${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ type: 'message', text: 'Ticket created', attachments: [card] }),
    });
    expect(sent.status).toBe(200);
    const sentActivityId = (await sent.json()).id;
    expect(sentActivityId).toBeTruthy();

    const updated = await fetch(
      `${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities/${encodeURIComponent(sentActivityId)}`,
      { method: 'PUT', headers, body: JSON.stringify({ type: 'message', text: 'Ticket TKT-1042 assigned' }) },
    );
    expect(updated.status).toBe(200);
    expect((await updated.json()).id).toBe(sentActivityId);

    const captured = await controlState('bot-activities');
    expect(captured).toHaveLength(2);
    expect(captured[0]).toMatchObject({
      method: 'POST',
      conversationId,
      type: 'message',
      text: 'Ticket created',
      id: sentActivityId,
    });
    expect(captured[0].attachments[0].content.body[0].text).toBe('Ticket TKT-1042 created');
    expect(captured[1]).toMatchObject({
      method: 'PUT',
      id: sentActivityId,
      pathActivityId: sentActivityId,
      text: 'Ticket TKT-1042 assigned',
    });
  });

  it('stamps consented application permissions into app-only tokens', async () => {
    const seeded = await controlPost('/control/msgraph/seed/client', {
      clientId: 'teams-graph-app',
      clientSecret: 'teams-graph-secret',
      appRoles: ['TeamsActivity.Send', 'User.Read.All'],
    });
    expect(seeded.ok).toBe(true);

    const claimsOf = (token: string) =>
      JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));

    const consented = await (
      await fetch(
        `${base}/common/oauth2/v2.0/token`,
        form({
          client_id: 'teams-graph-app',
          client_secret: 'teams-graph-secret',
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        }),
      )
    ).json();
    // Entra puts admin-consented application permissions in `roles` (never
    // `scp`) on app-only tokens; the Teams setup probe reads them from there.
    expect(claimsOf(consented.access_token)).toMatchObject({
      roles: ['TeamsActivity.Send', 'User.Read.All'],
    });
    expect(claimsOf(consented.access_token).scp).toBeUndefined();

    // A client seeded without consent gets an empty roles claim.
    const unconsented = await (
      await fetch(
        `${base}/common/oauth2/v2.0/token`,
        form({
          client_id: 'premise-app',
          client_secret: 'premise-secret',
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        }),
      )
    ).json();
    expect(claimsOf(unconsented.access_token).roles).toEqual([]);

    // Delegated tokens are the other way round.
    expect(claimsOf(accessToken).scp).toBeTruthy();
    expect(claimsOf(accessToken).roles).toBeUndefined();
  });

  it('records activity notifications and serves teams, channels, and chats', async () => {
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };

    const channel = await controlPost('/control/msgraph/seed/teams-channel', {
      teamId: 'team-helpdesk',
      teamDisplayName: 'Helpdesk',
      id: 'channel-triage',
      displayName: 'Triage',
    });
    expect(channel.ok).toBe(true);

    const chat = await controlPost('/control/msgraph/seed/teams-chat', {
      id: 'chat-wanda',
      chatType: 'oneOnOne',
      members: [{ id: '29:guest-client-contact', displayName: 'Wanda Client', userId: 'guest-client-contact' }],
      messages: [{ content: 'My printer is on fire', fromName: 'Wanda Client' }],
    });
    expect(chat.ok).toBe(true);

    const teams = await (await fetch(`${base}/v1.0/teams`, { headers })).json();
    expect(teams.value).toEqual([{ id: 'team-helpdesk', displayName: 'Helpdesk', description: null }]);

    const channels = await (await fetch(`${base}/v1.0/teams/team-helpdesk/channels`, { headers })).json();
    expect(channels.value).toEqual([
      { id: 'channel-triage', displayName: 'Triage', description: null, membershipType: 'standard' },
    ]);
    expect((await fetch(`${base}/v1.0/teams/nope`, { headers })).status).toBe(404);

    const chats = await (await fetch(`${base}/v1.0/chats`, { headers })).json();
    expect(chats.value).toEqual([expect.objectContaining({ id: 'chat-wanda', chatType: 'oneOnOne' })]);

    const chatMessages = await (await fetch(`${base}/v1.0/chats/chat-wanda/messages`, { headers })).json();
    expect(chatMessages.value[0].body.content).toBe('My printer is on fire');

    const notification = await fetch(
      `${base}/v1.0/users/guest-client-contact/teamwork/sendActivityNotification`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ activityType: 'taskAssigned', topic: { source: 'text', value: 'TKT-1042' } }),
      },
    );
    expect(notification.status).toBe(202);

    const recorded = await controlState('activity-notifications');
    expect(recorded).toEqual([
      expect.objectContaining({
        userId: 'guest-client-contact',
        body: { activityType: 'taskAssigned', topic: { source: 'text', value: 'TKT-1042' } },
      }),
    ]);
  });

  it('throttles the connector and activity notification routes via operation faults', async () => {
    await controlPost('/control/msgraph/faults/operation-fault/arm', {
      operation: `POST /v3/conversations/${conversationId}/activities`,
      status: 429,
      body: { error: { code: 'Throttled' } },
      remaining: 1,
    });
    const botHeaders = { authorization: `Bearer ${botToken}`, 'content-type': 'application/json' };
    const activityUrl = `${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`;
    const throttled = await fetch(activityUrl, {
      method: 'POST',
      headers: botHeaders,
      body: JSON.stringify({ type: 'message', text: 'retry me' }),
    });
    expect(throttled.status).toBe(429);
    expect((await throttled.json()).error.code).toBe('Throttled');
    expect(
      (await fetch(activityUrl, { method: 'POST', headers: botHeaders, body: JSON.stringify({ type: 'message', text: 'retry me' }) }))
        .status,
    ).toBe(200);

    await controlPost('/control/msgraph/faults/operation-fault/arm', {
      operation: 'POST /users/guest-client-contact/teamwork/sendActivityNotification',
      status: 429,
      remaining: 1,
    });
    const headers = { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' };
    const url = `${base}/v1.0/users/guest-client-contact/teamwork/sendActivityNotification`;
    expect((await fetch(url, { method: 'POST', headers, body: '{}' })).status).toBe(429);
    expect((await fetch(url, { method: 'POST', headers, body: '{}' })).status).toBe(202);

    const cleared = await controlPost('/control/msgraph/actions/clear-bot-activities');
    expect(cleared.result.cleared).toBe(3);
    expect(await controlState('bot-activities')).toEqual([]);
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

  // Last: reset wipes the client registrations every earlier test relies on.
  it('clears the Teams surface on reset', async () => {
    const appToken = (
      await (
        await fetch(
          `${base}/common/oauth2/v2.0/token`,
          form({
            client_id: 'premise-app',
            client_secret: 'premise-secret',
            grant_type: 'client_credentials',
            scope: 'https://api.botframework.com/.default',
          }),
        )
      ).json()
    ).access_token;
    await fetch(`${base}/v3/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: 'POST',
      headers: { authorization: `Bearer ${appToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'message', text: 'still here' }),
    });
    expect(await controlState('bot-activities')).toHaveLength(1);
    expect(await controlState('teams')).toHaveLength(1);

    await controlPost('/control/msgraph/reset');

    for (const view of ['bot-activities', 'activity-notifications', 'teams', 'chats']) {
      expect(await controlState(view)).toEqual([]);
    }
    expect((await controlState('config')).bot).toEqual({
      targetUrl: 'http://localhost:3000/api/teams/bot/messages',
      serviceUrl: 'http://localhost:4010',
      appId: 'emulated-teams-bot-app-id',
      tenantId: '11111111-2222-4333-8444-555555555555',
    });

    // reset() must not rotate the signing key: the app caches the JWKS for 12h.
    const jwksAfterReset = await (await fetch(`${base}/v1/.well-known/keys`)).json();
    expect(jwksAfterReset).toEqual(jwksBeforeReset);
  });
});
