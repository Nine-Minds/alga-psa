import http from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';
import type { TeamsBotActivity } from '../../../../ee/packages/microsoft-teams/src/lib/teams/bot/teamsBotHandler';

let host: EmulatorHost;
let receiver: http.Server;
let base: string;
let control: string;
let target: string;
let tamperIdentity: 'sender' | 'tenant' | null = null;
let authenticate: typeof import('../../../../ee/packages/microsoft-teams/src/lib/teams/bot/teamsInboundAuth').authenticateTeamsInboundRequest;
let connector: typeof import('../../../../ee/packages/microsoft-teams/src/lib/teams/bot/teamsBotConnector');
const appId = 'wire-bot-client';
const identity = { user: 'wire-user', tenant: 'wire-tenant' };

async function command(path: string, body: unknown = {}) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  const result = await response.json();
  expect(result.ok).toBe(true);
  return result.result;
}
async function activities() {
  const response = await fetch(`${control}/control/msgraph/state/bot-activities`);
  expect(response.ok).toBe(true);
  return (await response.json()).result as Array<{
    id: string;
    method: string;
    text: string;
    conversationId: string;
  }>;
}
async function deliver(overrides: Record<string, unknown> = {}) {
  return command('seed/bot-activity', {
    targetUrl: target,
    serviceUrl: base,
    appId,
    fromAadObjectId: identity.user,
    tenantId: identity.tenant,
    conversationId: 'conversation/with spaces',
    text: 'Authenticated reply',
    ...overrides,
  });
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
  // A minimal receiver around the actual shared route guard and connector.
  // Business commands, linked-user lookup and database writes are not replaced
  // with fake successes here; they are outside this adapter-level test.
  receiver = http.createServer(async (incoming, outgoing) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of incoming) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (tamperIdentity === 'sender') body.from.aadObjectId = 'forged-user';
      if (tamperIdentity === 'tenant') body.channelData.tenant.id = 'forged-tenant';
      const request = new Request(target, {
        method: 'POST',
        headers: {
          authorization: String(incoming.headers.authorization ?? ''),
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      const auth = await authenticate<TeamsBotActivity>(request, 'bot');
      if (!auth.ok) {
        outgoing.writeHead(auth.response.status, { 'content-type': 'application/json' });
        outgoing.end(await auth.response.text());
        return;
      }
      await connector.sendBotActivity({
        serviceUrl: auth.identity.serviceUrl!,
        conversationId: auth.activity.conversation!.id!,
        activity: { type: 'message', text: auth.activity.text },
      });
      outgoing.writeHead(200, { 'content-type': 'application/json' });
      outgoing.end(
        JSON.stringify({
          microsoftUserId: auth.identity.microsoftUserId,
          microsoftTenantId: auth.identity.microsoftTenantId,
        }),
      );
    } catch {
      outgoing.writeHead(500).end('Adapter receiver failed');
    }
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  target = `http://127.0.0.1:${(receiver.address() as { port: number }).port}/api/teams/bot/messages`;
});
beforeEach(async () => {
  await command('reset');
  vi.resetModules();
  tamperIdentity = null;
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
  vi.stubEnv('TEAMS_BOT_APP_ID', appId);
  vi.stubEnv('TEAMS_BOT_APP_TENANT_ID', identity.tenant);
  vi.stubEnv('TEAMS_BOT_APP_PASSWORD', 'synthetic-bot-secret');
  vi.stubEnv('TEAMS_BOT_SERVICE_URL_ALLOWLIST', base);
  vi.stubEnv('TEAMS_BOT_OPENID_CONFIG_URL', `${base}/v1/.well-known/openidconfiguration`);
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base);
  await command('seed/client', { clientId: appId, clientSecret: 'synthetic-bot-secret' });
  ({ authenticateTeamsInboundRequest: authenticate } =
    await import('../../../../ee/packages/microsoft-teams/src/lib/teams/bot/teamsInboundAuth'));
  connector =
    await import('../../../../ee/packages/microsoft-teams/src/lib/teams/bot/teamsBotConnector');
});
afterEach(() => vi.unstubAllEnvs());
afterAll(async () => {
  if (receiver)
    await new Promise<void>((resolve, reject) =>
      receiver.close((error) => (error ? reject(error) : resolve())),
    );
  await host?.stop();
});

it('authenticates signed inbound activities and refreshes an expired outbound token without duplicate replies', async () => {
  expect(await deliver()).toMatchObject({
    delivered: true,
    status: 200,
    response: {
      microsoftUserId: identity.user,
      microsoftTenantId: identity.tenant,
    },
  });
  await command('actions/expire-access-tokens');
  expect(await deliver({ text: 'Reply after expiry' })).toMatchObject({
    delivered: true,
    status: 200,
  });
  const recorded = await activities();
  expect(recorded).toHaveLength(2);
  expect(recorded.map((activity) => activity.text)).toEqual([
    'Authenticated reply',
    'Reply after expiry',
  ]);
  expect(recorded.every((activity) => activity.conversationId === 'conversation/with spaces')).toBe(
    true,
  );
  expect(
    await connector.updateBotActivity({
      serviceUrl: base,
      conversationId: recorded[1].conversationId,
      activityId: recorded[1].id,
      activity: { type: 'message', text: 'Updated card' },
    }),
  ).toEqual({ status: 'sent' });
  expect((await activities()).at(-1)).toMatchObject({
    id: recorded[1].id,
    method: 'PUT',
    text: 'Updated card',
  });
});

it.each([
  ['wrong audience', { appId: 'another-bot' }],
  ['expired signature', { tokenAgeSeconds: 7200 }],
  ['untrusted reply destination', { serviceUrl: 'https://untrusted.example.invalid' }],
])('rejects %s before emitting a reply', async (_name, overrides) => {
  expect(await deliver(overrides)).toMatchObject({ delivered: true, status: 401 });
  expect(await activities()).toEqual([]);
});
it.each(['sender', 'tenant'] as const)(
  'rejects a modified %s despite a correctly signed inbound token',
  async (field) => {
    tamperIdentity = field;
    expect(await deliver()).toMatchObject({ delivered: true, status: 401 });
    expect(await activities()).toEqual([]);
  },
);
