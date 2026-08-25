import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import msgraphEmulator from '../src/index';

/**
 * Teams Phone call-record surface: seed → change notification → CDR fetch, plus
 * the usability round (state persistence, default actor, prefix faults, seed
 * presets, scenario recording).
 */

let host: EmulatorHost;
let base: string;
let control: string;
let webhook: http.Server;
let webhookPort: number;
let botEndpoint: http.Server;
let botEndpointUrl: string;
const notifications: any[] = [];
const inboundActivities: any[] = [];
const stateFile = join(mkdtempSync(join(tmpdir(), 'algasim-state-')), 'state.json');

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

async function appToken(): Promise<string> {
  const response = await fetch(`${base}/tenant-1/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: 'telephony-app',
      client_secret: 'telephony-secret',
      grant_type: 'client_credentials',
      scope: 'https://graph.microsoft.com/.default',
    }),
  });
  return ((await response.json()) as any).access_token;
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
      inboundActivities.push(await readJsonBody(req));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ type: 'message', text: 'ack' }));
    })
    .listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => botEndpoint.once('listening', resolve));
  botEndpointUrl = `http://127.0.0.1:${(botEndpoint.address() as { port: number }).port}/api/teams/bot/messages`;

  host = new EmulatorHost({
    emulators: [msgraphEmulator],
    controlPort: 0,
    ports: { msgraph: 0 },
    stateFile,
    recordScenario: true,
  });
  const started = await host.start();
  base = `http://127.0.0.1:${started.ports.msgraph}`;
  control = `http://127.0.0.1:${started.controlPort}`;

  await controlPost('/control/msgraph/seed/client', {
    clientId: 'telephony-app',
    clientSecret: 'telephony-secret',
    appRoles: ['CallRecords.Read.All'],
  });
});

afterAll(async () => {
  await host.stop();
  await new Promise((resolve) => webhook.close(resolve));
  await new Promise((resolve) => botEndpoint.close(resolve));
});

describe('msgraph call records', { shuffle: false }, () => {
  let callRecordId: string;

  it('T047: seeding a call notifies only callRecords subscriptions', async () => {
    const headers = { authorization: `Bearer ${await appToken()}`, 'content-type': 'application/json' };

    const callSubscription = await fetch(`${base}/v1.0/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        changeType: 'created,updated',
        notificationUrl: `http://127.0.0.1:${webhookPort}/webhook`,
        resource: 'communications/callRecords',
        expirationDateTime: new Date(Date.now() + 3_600_000).toISOString(),
        clientState: 'telephony-call-records:tenant-1:teams-phone:secret',
      }),
    });
    expect(callSubscription.status).toBe(201);

    // A meeting-artifact subscription must not receive call notifications.
    await fetch(`${base}/v1.0/subscriptions`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        changeType: 'created,updated',
        notificationUrl: `http://127.0.0.1:${webhookPort}/webhook`,
        resource: 'communications/onlineMeetings/getAllRecordings',
        expirationDateTime: new Date(Date.now() + 3_600_000).toISOString(),
        clientState: 'teams-online-meeting-artifacts:tenant-1:recordings:secret',
      }),
    });

    const before = notifications.length;
    const seeded = await controlPost('/control/msgraph/seed/call-record', {
      direction: 'inbound',
      callerNumber: '+15551234567',
      calleeNumber: '+15559990000',
      durationSeconds: 180,
    });
    expect(seeded.ok).toBe(true);
    expect(seeded.result.deliveries).toHaveLength(1);
    expect(seeded.result.deliveries[0].delivered).toBe(true);

    callRecordId = seeded.result.callRecord.id;
    const notification = notifications[before];
    expect(notification.value[0].resource).toBe(`communications/callRecords('${callRecordId}')`);
    expect(notification.value[0].clientState).toBe('telephony-call-records:tenant-1:teams-phone:secret');
  });

  it('T050: a mailbox message reaches neither the call nor the artifact subscription', async () => {
    const before = notifications.length;
    await controlPost('/control/msgraph/seed/message', { subject: 'hello' });
    expect(notifications.length).toBe(before);
  });

  it('T048: the CDR route honours $expand=sessions', async () => {
    const headers = { authorization: `Bearer ${await appToken()}` };

    const expanded = (await (
      await fetch(`${base}/v1.0/communications/callRecords/${callRecordId}?$expand=sessions`, { headers })
    ).json()) as any;
    expect(expanded.id).toBe(callRecordId);
    expect(expanded.sessions).toHaveLength(1);
    expect(expanded.sessions[0].caller.identity.phone.id).toBe('+15551234567');
    expect(expanded.sessions[0].callee.identity.user.id).toBeTruthy();

    const plain = (await (
      await fetch(`${base}/v1.0/communications/callRecords/${callRecordId}`, { headers })
    ).json()) as any;
    expect(plain.sessions).toBeUndefined();

    expect((await fetch(`${base}/v1.0/communications/callRecords/nope`, { headers })).status).toBe(404);
  });

  it('maps an unanswered call to a failed, zero-length session', async () => {
    const seeded = await controlPost('/control/msgraph/seed/call-record', {
      direction: 'inbound',
      callerNumber: '+15557654321',
      answered: false,
    });
    const record = seeded.result.callRecord;
    expect(record.startDateTime).toBe(record.endDateTime);
    expect(record.sessions[0].failureInfo.stage).toBe('callSetup');
  });

  it('T049: the call-records state view lists seeds with their delivery results', async () => {
    const view = await controlState('call-records');
    expect(view.length).toBe(2);
    expect(view[0].deliveries[0].delivered).toBe(true);
  });

  it('T077: call artifacts are enumerated via getAll functions and fetched by id, per real Graph', async () => {
    const headers = { authorization: `Bearer ${await appToken()}` };
    const adhocCall = `${base}/v1.0/users/emulated-organizer/adhocCalls/${callRecordId}`;
    const getAll = (fn: string) =>
      `${base}/v1.0/users/emulated-organizer/adhocCalls/${fn}(userId=emulated-organizer)`;

    // The per-call list endpoint is FICTION — real Graph has no such route,
    // and serving it is how endpoint bugs get validated locally.
    expect((await fetch(`${adhocCall}/recordings`, { headers })).status).toBe(404);

    // Nothing recorded yet is the normal case: empty getAll collections.
    expect((await (await fetch(getAll('getAllRecordings'), { headers })).json()).value).toEqual([]);

    const transcript = await controlPost('/control/msgraph/seed/call-transcript', {
      callId: callRecordId,
      content: 'WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n<v Dorothy Gale>The printer is on fire again.',
    });
    expect(transcript.ok).toBe(true);
    const recording = await controlPost('/control/msgraph/seed/call-recording', { callId: callRecordId });
    expect(recording.ok).toBe(true);

    // getAllTranscripts items carry callId — the join key the app filters on.
    const transcripts = (await (await fetch(getAll('getAllTranscripts'), { headers })).json()) as any;
    expect(transcripts.value).toHaveLength(1);
    expect(transcripts.value[0].id).toBe(transcript.result.artifact.id);
    expect(transcripts.value[0].callId).toBe(callRecordId);

    // Windowing: a window that ends before the artifact excludes it.
    const early = (await (await fetch(
      `${base}/v1.0/users/emulated-organizer/adhocCalls/getAllTranscripts(userId=emulated-organizer,startDateTime=2000-01-01T00:00:00Z,endDateTime=2000-01-02T00:00:00Z)`,
      { headers },
    )).json()) as any;
    expect(early.value).toEqual([]);

    // Single-item get and content, by artifact id — the documented fetch path.
    const single = (await (await fetch(
      `${adhocCall}/transcripts/${transcript.result.artifact.id}`,
      { headers },
    )).json()) as any;
    expect(single.callId).toBe(callRecordId);
    const content = await fetch(
      `${adhocCall}/transcripts/${transcript.result.artifact.id}/content`,
      { headers },
    );
    expect(content.headers.get('content-type')).toContain('text/vtt');
    expect(await content.text()).toContain('The printer is on fire again.');

    const recordings = (await (await fetch(getAll('getAllRecordings'), { headers })).json()) as any;
    expect(recordings.value).toHaveLength(1);
    expect(recordings.value[0].callId).toBe(callRecordId);

    // Seeding an artifact for a call that does not exist is a 404, and no
    // notification is ever delivered — Graph has none for ad hoc calls.
    const before = notifications.length;
    const orphan = await controlPost('/control/msgraph/seed/call-transcript', { callId: 'no-such-call' });
    expect(orphan.ok).toBe(false);
    expect(notifications.length).toBe(before);
  });

  it('T077: the call-records state view shows captured artifacts by size', async () => {
    const view = await controlState('call-records');
    const withArtifacts = view.find((record: any) => record.id === callRecordId);
    expect(withArtifacts.artifacts.map((artifact: any) => artifact.kind).sort()).toEqual([
      'recording',
      'transcript',
    ]);
    expect(withArtifacts.artifacts[0].contentBytes).toBeGreaterThan(0);
    // The state view never carries artifact bodies.
    expect(withArtifacts.artifacts[0].content).toBeUndefined();
  });

  it('T052: a bot-activity seed falls back to the configured default actor', async () => {
    await controlPost('/control/msgraph/actions/configure', {
      botTargetUrl: botEndpointUrl,
      defaultActor: {
        fromAadObjectId: 'aad-default-actor',
        fromName: 'Default Dorothy',
        conversationId: 'conversation-default',
      },
    });

    await controlPost('/control/msgraph/seed/bot-activity', { text: 'no identity supplied' });
    const fromDefault = inboundActivities.at(-1);
    expect(fromDefault.from.aadObjectId).toBe('aad-default-actor');
    expect(fromDefault.from.name).toBe('Default Dorothy');
    expect(fromDefault.conversation.id).toBe('conversation-default');

    await controlPost('/control/msgraph/seed/bot-activity', {
      text: 'explicit wins',
      fromAadObjectId: 'aad-explicit',
      conversationId: 'conversation-explicit',
    });
    const explicit = inboundActivities.at(-1);
    expect(explicit.from.aadObjectId).toBe('aad-explicit');
    expect(explicit.conversation.id).toBe('conversation-explicit');
  });

  it('T053: a prefix fault matches a variable path once and then stops', async () => {
    await controlPost('/control/msgraph/faults/operation-fault/arm', {
      operation: 'GET /communications/callRecords/*',
      status: 503,
      remaining: 1,
    });

    const headers = { authorization: `Bearer ${await appToken()}` };
    expect((await fetch(`${base}/v1.0/communications/callRecords/${callRecordId}`, { headers })).status).toBe(503);
    expect((await fetch(`${base}/v1.0/communications/callRecords/${callRecordId}`, { headers })).status).toBe(200);
  });

  it('T055: seed presets round-trip through the control surface', async () => {
    await controlPost('/control/msgraph/actions/save-seed-preset', {
      name: 'inbound-support-call',
      seeder: 'call-record',
      payload: { direction: 'inbound', callerNumber: '+15551112222' },
    });

    const presets = await controlState('seed-presets');
    expect(presets).toHaveLength(1);
    expect(presets[0].payload.callerNumber).toBe('+15551112222');

    const replay = await controlPost(`/control/msgraph/seed/${presets[0].seeder}`, presets[0].payload);
    expect(replay.ok).toBe(true);

    await controlPost('/control/msgraph/actions/delete-seed-preset', { name: 'inbound-support-call' });
    expect(await controlState('seed-presets')).toEqual([]);
  });

  it('T054: record mode captures the control calls as a replayable scenario', async () => {
    const recording = (await (await fetch(`${control}/control/recording`)).json()).result;
    expect(recording.enabled).toBe(true);
    const seeds = recording.scenario.steps.filter((step: any) => step.seed === 'msgraph/call-record');
    expect(seeds.length).toBeGreaterThanOrEqual(3);
    expect(seeds[0].params.direction).toBe('inbound');
  });

  it('T051: a fresh host restores seeded state from the state file', async () => {
    // Flush the debounced snapshot by stopping, then boot a second host on the
    // same file the way a container restart would.
    const seededCallCount = (await controlState('call-records')).length;
    await host.stop();

    const restored = new EmulatorHost({
      emulators: [msgraphEmulator],
      controlPort: 0,
      ports: { msgraph: 0 },
      stateFile,
    });
    const started = await restored.start();
    const restoredControl = `http://127.0.0.1:${started.controlPort}`;
    const view = (await (await fetch(`${restoredControl}/control/msgraph/state/call-records`)).json()).result;
    expect(view.length).toBe(seededCallCount);

    expect(view.find((record: any) => record.id === callRecordId).artifacts).toHaveLength(2);

    const config = (await (await fetch(`${restoredControl}/control/msgraph/state/config`)).json()).result;
    expect(config.defaultActor.fromAadObjectId).toBe('aad-default-actor');

    // Registered clients are configuration, not a session: without them the
    // restored emulator answers every app-only token request with
    // invalid_client while its seeds still look perfectly healthy.
    const restoredBase = `http://127.0.0.1:${started.ports.msgraph}`;
    const token = await fetch(`${restoredBase}/tenant-1/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: 'telephony-app',
        client_secret: 'telephony-secret',
        grant_type: 'client_credentials',
        scope: 'https://graph.microsoft.com/.default',
      }),
    });
    expect(token.status).toBe(200);

    await restored.stop();

    // Restart the original host so afterAll's stop() stays valid.
    host = new EmulatorHost({ emulators: [msgraphEmulator], controlPort: 0, ports: { msgraph: 0 } });
    await host.start();
  });
});
