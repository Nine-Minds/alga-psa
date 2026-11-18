import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraph from '../src/index';

const config = vi.hoisted(() => ({
  organizerUpn: 'organizer@contoso.example',
  organizerUserId: 'organizer-id',
  microsoftTenantId: 'meeting-tenant',
  clientId: 'meeting-client',
  clientSecret: 'synthetic-secret',
  sendMeetingInvites: false,
}));
// Same boundary as teamsMeetingAdapter.test.ts: only tenant configuration and
// background subscription scheduling are replaced. Graph traffic is real HTTP.
vi.mock('../../../../ee/packages/microsoft-teams/src/lib/meetings/meetingConfig', () => ({
  resolveTeamsMeetingConfigState: async () => ({ status: 'ready', config }),
  resolveTeamsMeetingGraphConfig: async () => config,
}));
vi.mock('../../../../ee/packages/microsoft-teams/src/lib/meetings/artifactSubscriptions', () => ({
  renewTeamsMeetingArtifactSubscriptions: async () => undefined,
}));
vi.mock('@alga-psa/core/logger', () => ({ default: { info: vi.fn(), warn: vi.fn() } }));

import { createTeamsMeetingWithResult } from '../../../../ee/packages/microsoft-teams/src/lib/meetings/createTeamsMeeting';
import {
  recoverTeamsMeetingCreation,
  TEAMS_CREATION_OPERATION_PROPERTY,
} from '../../../../ee/packages/microsoft-teams/src/lib/meetings/meetingCreationRecovery';

let host: EmulatorHost;
let base: string;
let control: string;

async function command(path: string, body: unknown) {
  const response = await fetch(`${control}/control/msgraph/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  expect((await response.json()).ok).toBe(true);
}
async function events() {
  const response = await fetch(`${control}/control/msgraph/state/calendar-events`);
  return (await response.json()).result as Array<Record<string, any>>;
}
async function requests() {
  const response = await fetch(`${control}/control/msgraph/requests`);
  const rows = (await response.json()).result.requests as Array<{ method: string; path: string; status: number }>;
  return rows.filter(row => /\/users\/[^/]+\/events/.test(row.path));
}
async function graphToken() {
  const response = await fetch(`${base}/${config.microsoftTenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  return (await response.json()).access_token as string;
}
async function graph(path: string, init: RequestInit = {}) {
  return fetch(`${base}/v1.0${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await graphToken()}`, 'content-type': 'application/json', ...init.headers },
  });
}
function postEvent(operationId: string) {
  return graph(`/users/${config.organizerUserId}/events`, {
    method: 'POST',
    body: JSON.stringify({
      transactionId: operationId,
      singleValueExtendedProperties: [{ id: TEAMS_CREATION_OPERATION_PROPERTY, value: operationId }],
      subject: 'committed but response lost',
      start: { dateTime: input.startDateTime, timeZone: 'UTC' },
      end: { dateTime: input.endDateTime, timeZone: 'UTC' },
      isOnlineMeeting: true,
      onlineMeetingProvider: 'teamsForBusiness',
    }),
  });
}

const input = {
  tenantId: 'isolated-psa-tenant',
  subject: 'Appointment with client',
  startDateTime: '2026-09-09T10:00:00Z',
  endDateTime: '2026-09-09T10:30:00Z',
};
const window = {
  start: { dateTime: input.startDateTime, timeZone: 'UTC' },
  end: { dateTime: input.endDateTime, timeZone: 'UTC' },
};
const target = () => ({
  microsoftTenantId: config.microsoftTenantId,
  organizerUserId: config.organizerUserId,
  organizerUpn: config.organizerUpn,
  sendMeetingInvites: config.sendMeetingInvites,
});

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [msgraph], controlPort: 0, ports: { msgraph: 0 } });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;
});
beforeEach(async () => {
  config.organizerUserId = 'organizer-id';
  await command('reset', {});
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('TEAMS_EMULATOR_MODE', 'true');
  vi.stubEnv('MICROSOFT_GRAPH_BASE_URL', `${base}/v1.0`);
  vi.stubEnv('MICROSOFT_LOGIN_BASE_URL', base);
  await command('seed/client', { clientId: config.clientId, clientSecret: config.clientSecret });
});
afterEach(() => {
  vi.unstubAllEnvs();
});
afterAll(async () => {
  await host?.stop();
});

describe('durable Teams create and recover against the emulator', () => {
  it('looks up by operation id (empty), then issues exactly one POST carrying transactionId and the extended property', async () => {
    const operationId = crypto.randomUUID();
    const out = await createTeamsMeetingWithResult({ ...input, creationIdentity: { operationId, target: target() } });
    expect(out.status).toBe('created');

    const log = (await requests()).map(row => row.method);
    expect(log).toEqual(['GET', 'POST']);
    const stored = await events();
    expect(stored).toHaveLength(1);
    expect(stored[0].transactionId).toBe(operationId);
    expect(stored[0].singleValueExtendedProperties).toEqual([{ id: TEAMS_CREATION_OPERATION_PROPERTY, value: operationId }]);
  });

  it('recovers a committed event read-only after a lost POST response', async () => {
    const operationId = crypto.randomUUID();
    expect((await postEvent(operationId)).status).toBe(201);
    const before = await events();
    const postsBefore = (await requests()).filter(row => row.method === 'POST').length;

    const out = await recoverTeamsMeetingCreation({ tenantId: input.tenantId, identity: { operationId, target: target() } });
    expect(out).toMatchObject({ status: 'found', event: { eventId: before[0].id } });
    expect(await events()).toHaveLength(before.length);
    expect((await requests()).filter(row => row.method === 'POST')).toHaveLength(postsBefore);
  });

  it('reports absent when the operation never reached Graph', async () => {
    expect(await recoverTeamsMeetingCreation({
      tenantId: input.tenantId,
      identity: { operationId: crypto.randomUUID(), target: target() },
    })).toEqual({ status: 'absent' });
  });

  it('attaches a retried create for the same operation id without a second POST', async () => {
    const operationId = crypto.randomUUID();
    await postEvent(operationId);
    const postsBefore = (await requests()).filter(row => row.method === 'POST').length;

    const out = await createTeamsMeetingWithResult({ ...input, creationIdentity: { operationId, target: target() } });
    expect(out.status).toBe('created');
    const stored = await events();
    expect(stored).toHaveLength(1);
    if (out.status === 'created') expect(out.meeting.eventId).toBe(stored[0].id);
    expect((await requests()).filter(row => row.method === 'POST')).toHaveLength(postsBefore);
  });

  it('refuses creation when the configured organizer drifted from the recorded target', async () => {
    const recorded = target();
    config.organizerUserId = 'a-different-organizer';
    const out = await createTeamsMeetingWithResult({
      ...input,
      creationIdentity: { operationId: crypto.randomUUID(), target: recorded },
    });
    expect(out).toMatchObject({ status: 'failed', errorCode: 'creation_target_changed' });
    expect(await requests()).toHaveLength(0);
    expect(await events()).toHaveLength(0);
  });

  it('keeps the Graph 4xx error body in errorMessage (injected via operation-fault)', async () => {
    await command('faults/operation-fault/arm', {
      operation: `POST /users/${encodeURIComponent(config.organizerUserId)}/events`,
      status: 403,
      remaining: 1,
      body: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } },
    });
    const out = await createTeamsMeetingWithResult({
      ...input,
      creationIdentity: { operationId: crypto.randomUUID(), target: target() },
    });
    expect(out).toMatchObject({ status: 'failed', errorCode: 'graph_unauthorized' });
    if (out.status === 'failed') {
      expect(out.errorMessage).toContain('(403)');
      expect(out.errorMessage).toContain('ErrorAccessDenied');
    }
  });
});

describe('GET /users/:userId/events wire behaviour', () => {
  const filterFor = (id: string, value: string) =>
    `singleValueExtendedProperties/Any(ep: ep/id eq '${id.replace(/'/g, "''")}' and ep/value eq '${value.replace(/'/g, "''")}')`;
  const list = (userId: string, query: string) => graph(`/users/${userId}/events?${query}`);

  it('answers any other $filter with 400 Request_UnsupportedQuery', async () => {
    const response = await list(config.organizerUserId, `$filter=${encodeURIComponent("subject eq 'x'")}`);
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('Request_UnsupportedQuery');
  });

  it('honours $select, $top, organizer scoping and OData quote unescaping', async () => {
    const quoted = "it's-op";
    for (const [user, value] of [[config.organizerUserId, quoted], [config.organizerUserId, quoted], ['other-user', quoted]] as const) {
      await graph(`/users/${user}/events`, {
        method: 'POST',
        body: JSON.stringify({ subject: 's', ...window, isOnlineMeeting: true, singleValueExtendedProperties: [{ id: "p'id", value }] }),
      });
    }
    const filter = encodeURIComponent(filterFor("p'id", quoted));
    const all = await (await list(config.organizerUserId, `$filter=${filter}`)).json();
    expect(all.value).toHaveLength(2);
    const top = await (await list(config.organizerUserId, `$filter=${filter}&$top=1&$select=id,onlineMeeting`)).json();
    expect(top.value).toHaveLength(1);
    expect(Object.keys(top.value[0]).sort()).toEqual(['id', 'onlineMeeting']);
    const none = await (await list(config.organizerUserId, `$filter=${encodeURIComponent(filterFor("p'id", 'nope'))}`)).json();
    expect(none.value).toEqual([]);
  });

  it('dedupes by organizer + transactionId and does not cross organizers', async () => {
    const body = JSON.stringify({ transactionId: 'tx-1', subject: 's', ...window, isOnlineMeeting: true });
    const a = await (await graph('/users/u1/events', { method: 'POST', body })).json();
    const b = await (await graph('/users/u1/events', { method: 'POST', body })).json();
    const c = await (await graph('/users/u2/events', { method: 'POST', body })).json();
    expect(b.id).toBe(a.id);
    expect(c.id).not.toBe(a.id);
    expect(await events()).toHaveLength(2);
  });
});
