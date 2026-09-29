import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { EmulatorHost } from '@alga-psa/emulator-host';
import threecxEmulator, { CALL_CONTROL_WS_PATH, EVENT_REMOVE, EVENT_UPSERT } from '../src/index';

let host: EmulatorHost;
let base: string;
let control: string;
const openSockets: WebSocket[] = [];

const APP = { clientId: 'alga', clientSecret: 'shh-secret' };

async function controlPost(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`${control}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return response.json();
}

const seed = (name: string, params: unknown) => controlPost(`/control/threecx/seed/${name}`, params);
const action = (name: string, params?: unknown) => controlPost(`/control/threecx/actions/${name}`, params);
const state = async (name: string): Promise<any> => (await (await fetch(`${control}/control/threecx/state/${name}`)).json()).result;

async function token(credentials = APP): Promise<{ status: number; body: any }> {
  const response = await fetch(`${base}/connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, grant_type: 'client_credentials' }),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function bearer(): Promise<string> {
  const { body } = await token();
  return body.access_token;
}

async function pbx(method: string, path: string, accessToken: string | null, body?: unknown): Promise<Response> {
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
}

function connectWs(accessToken: string | null): Promise<{ ws: WebSocket; events: any[]; next: () => Promise<any> }> {
  return new Promise((resolve, reject) => {
    const url = `${base.replace('http', 'ws')}${CALL_CONTROL_WS_PATH}`;
    const ws = new WebSocket(url, accessToken ? { headers: { authorization: `Bearer ${accessToken}` } } : {});
    openSockets.push(ws);
    const events: any[] = [];
    const waiters: Array<(event: any) => void> = [];
    ws.on('message', (raw) => {
      const event = JSON.parse(raw.toString());
      const waiter = waiters.shift();
      if (waiter) waiter(event);
      else events.push(event);
    });
    const next = () =>
      new Promise<any>((res, rej) => {
        if (events.length) return res(events.shift());
        const timer = setTimeout(() => rej(new Error('no WebSocket event within 3s')), 3000);
        waiters.push((event) => { clearTimeout(timer); res(event); });
      });
    ws.once('open', () => resolve({ ws, events, next }));
    ws.once('unexpected-response', (_req, res) => reject(new Error(`handshake ${res.statusCode}`)));
    ws.once('error', reject);
  });
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [threecxEmulator], controlPort: 0, ports: { threecx: 0 } });
  const { controlPort, ports } = await host.start();
  base = `http://127.0.0.1:${ports.threecx}`;
  control = `http://127.0.0.1:${controlPort}`;
});

afterAll(async () => {
  for (const ws of openSockets) ws.terminate();
  await host?.stop();
});

beforeEach(async () => {
  for (const ws of openSockets.splice(0)) ws.terminate();
  await controlPost('/control/threecx/reset');
  await seed('pbx-app', APP);
});

describe('token endpoint and bearer gate', () => {
  it('T186: POST /connect/token answers a token for the seeded app and 401 for wrong credentials', async () => {
    const ok = await token();
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ expires_in: 3600, token_type: 'Bearer' });
    expect(typeof ok.body.access_token).toBe('string');

    const bad = await token({ clientId: 'alga', clientSecret: 'nope' });
    expect(bad.status).toBe(401);

    const tokens = await state('tokens');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].clientId).toBe('alga');
    expect(tokens[0].token).not.toBe(ok.body.access_token);
  });

  it('T187: GET /xapi/v1/Users without a bearer answers 401; a made-up bearer too', async () => {
    expect((await pbx('GET', '/xapi/v1/Users', null)).status).toBe(401);
    expect((await pbx('GET', '/xapi/v1/Users', 'not-issued')).status).toBe(401);
    expect((await pbx('GET', '/xapi/v1/Users', await bearer())).status).toBe(200);
  });

  it('T185: GET / health stays open without a bearer', async () => {
    const health = await (await fetch(`${base}/`)).json();
    expect(health).toMatchObject({ ok: true, emulator: 'threecx', exchanges: 0 });
  });

  it('an issued token stops working once the virtual clock passes its expiry', async () => {
    const accessToken = await bearer();
    await controlPost('/control/clock/advance', { duration: '2h' });
    expect((await pbx('GET', '/xapi/v1/Defs', accessToken)).status).toBe(401);
  });
});

describe('capabilities', () => {
  it('T188: GET /callcontrol answers 403 when the app lacks callControl, and Defs 403 without xapi', async () => {
    await seed('pbx-app', { ...APP, callControl: false });
    let accessToken = await bearer();
    expect((await pbx('GET', '/xapi/v1/Defs', accessToken)).status).toBe(200);
    expect((await pbx('GET', '/callcontrol', accessToken)).status).toBe(403);

    await seed('pbx-app', { ...APP, callControl: true, xapi: false });
    accessToken = await bearer();
    expect((await pbx('GET', '/xapi/v1/Defs', accessToken)).status).toBe(403);
    const callcontrol = await pbx('GET', '/callcontrol', accessToken);
    expect(callcontrol.status).toBe(200);
    expect(await callcontrol.json()).toEqual([]);
  });

  it('GET /xapi/v1/Defs answers the probe shape', async () => {
    const res = await pbx('GET', '/xapi/v1/Defs?%24select=Id', await bearer());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ value: [{ Id: 1 }] });
  });
});

describe('users', () => {
  it('T189: GET /xapi/v1/Users honours $select, $top and $skip', async () => {
    for (const n of [100, 101, 102]) {
      await seed('pbx-user', { dn: String(n), email: `u${n}@example.com`, firstName: 'User', lastName: String(n) });
    }
    const accessToken = await bearer();
    const all = await (await pbx('GET', '/xapi/v1/Users', accessToken)).json();
    expect(all.value).toHaveLength(3);
    expect(all.value[0]).toMatchObject({ Number: '100', FirstName: 'User', LastName: '100', EmailAddress: 'u100@example.com', Enabled: true });
    expect(typeof all.value[0].Id).toBe('number');

    const query = new URLSearchParams({ $select: 'Number,EmailAddress', $top: '1', $skip: '1' });
    const page = await (await pbx('GET', `/xapi/v1/Users?${query}`, accessToken)).json();
    expect(page.value).toEqual([{ Number: '101', EmailAddress: 'u101@example.com' }]);

    const listed = await (await pbx('GET', '/callcontrol', accessToken)).json();
    expect(listed.map((d: any) => d.dn)).toEqual(['100', '101', '102']);
  });
});

describe('contacts', () => {
  it('T190: POST answers 201 with an Id, PATCH updates, DELETE removes, DeleteContactsById removes several', async () => {
    const accessToken = await bearer();
    const created = await pbx('POST', '/xapi/v1/Contacts', accessToken, { FirstName: 'Ada', LastName: 'Lovelace', Business: '+15550001111' });
    expect(created.status).toBe(201);
    const contact = await created.json();
    expect(typeof contact.Id).toBe('number');
    expect(contact).toMatchObject({ FirstName: 'Ada', LastName: 'Lovelace', Business: '+15550001111', Email: null });

    const patched = await pbx('PATCH', `/xapi/v1/Contacts(${contact.Id})`, accessToken, { Email: 'ada@example.com' });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toMatchObject({ Id: contact.Id, FirstName: 'Ada', Email: 'ada@example.com' });
    expect((await (await pbx('GET', `/xapi/v1/Contacts(${contact.Id})`, accessToken)).json()).Email).toBe('ada@example.com');

    const seeded = (await seed('pbx-contact', { FirstName: 'Seeded', Business: '+15550002222' })).result;
    const seeded2 = (await seed('pbx-contact', { FirstName: 'Seeded2' })).result;
    const paged = await (await pbx('GET', '/xapi/v1/Contacts?%24top=2&%24skip=1', accessToken)).json();
    expect(paged.value.map((c: any) => c.Id)).toEqual([seeded.Id, seeded2.Id]);

    expect((await pbx('DELETE', `/xapi/v1/Contacts(${contact.Id})`, accessToken)).status).toBe(204);
    expect((await pbx('GET', `/xapi/v1/Contacts(${contact.Id})`, accessToken)).status).toBe(404);
    expect((await pbx('PATCH', `/xapi/v1/Contacts(${contact.Id})`, accessToken, { Email: 'x' })).status).toBe(404);
    expect((await pbx('DELETE', `/xapi/v1/Contacts(${contact.Id})`, accessToken)).status).toBe(404);

    const bulk = await pbx('POST', '/xapi/v1/Contacts/Pbx.DeleteContactsById', accessToken, { ids: [seeded.Id, seeded2.Id] });
    expect(bulk.status).toBe(204);
    expect(await state('pbx-contacts')).toEqual([]);
  });
});

describe('call history and recordings', () => {
  const segment = (start: string, extra: Record<string, unknown> = {}) => seed('cdr-segment', {
    SegmentStartTime: start,
    SegmentEndTime: start,
    CallTime: 'PT1M35S',
    CallAnswered: true,
    SrcDn: '',
    SrcCallerNumber: '+15550001111',
    SrcDisplayName: 'Caller',
    SrcExternal: true,
    DstDn: '100',
    DstCallerNumber: '100',
    DstDisplayName: 'User 100',
    DstExternal: false,
    ...extra,
  });

  it('T191: CallHistoryView honours $filter on SegmentStartTime ge/le with and, $orderby, and pages', async () => {
    await segment('2026-08-31T10:00:00Z');
    await segment('2026-09-01T10:00:00Z');
    await segment('2026-09-02T10:00:00Z');
    await segment('2026-09-03T10:00:00Z');
    const accessToken = await bearer();

    const from = new URLSearchParams({ $filter: 'SegmentStartTime ge 2026-09-01T00:00:00Z', $orderby: 'SegmentStartTime asc' });
    const rows = (await (await pbx('GET', `/xapi/v1/CallHistoryView?${from}`, accessToken)).json()).value;
    expect(rows.map((r: any) => r.SegmentStartTime)).toEqual(['2026-09-01T10:00:00Z', '2026-09-02T10:00:00Z', '2026-09-03T10:00:00Z']);
    expect(rows[0]).toMatchObject({ CallTime: 'PT1M35S', SrcExternal: true, DstDn: '100' });
    expect(typeof rows[0].SegmentId).toBe('number');

    const window = new URLSearchParams({
      $filter: 'SegmentStartTime ge 2026-09-01T00:00:00Z and SegmentStartTime le 2026-09-02T23:59:59Z',
      $orderby: 'SegmentStartTime desc',
      $top: '1',
      $skip: '1',
    });
    const page = (await (await pbx('GET', `/xapi/v1/CallHistoryView?${window}`, accessToken)).json()).value;
    expect(page.map((r: any) => r.SegmentStartTime)).toEqual(['2026-09-01T10:00:00Z']);

    const bad = await pbx('GET', `/xapi/v1/CallHistoryView?${new URLSearchParams({ $filter: 'nonsense' })}`, accessToken);
    expect(bad.status).toBe(400);
  });

  it('T192: Recordings honours $filter on StartTime and DownloadRecording streams bytes', async () => {
    const early = (await seed('recording', { StartTime: '2026-08-01T00:00:00Z', EndTime: '2026-08-01T00:01:00Z', FromCallerNumber: '+15550001111', ToDn: '100' })).result;
    const bytes = Buffer.from('hello-wav');
    const late = (await seed('recording', {
      StartTime: '2026-09-01T00:00:00Z',
      EndTime: '2026-09-01T00:02:00Z',
      FromCallerNumber: '+15550001111',
      ToDn: '100',
      IsTranscribed: true,
      Transcription: 'Hi, this is a test.',
      Summary: 'Test call.',
      RecordingUrl: 'https://pbx.example/rec/2.wav',
      bytesBase64: bytes.toString('base64'),
    })).result;
    const accessToken = await bearer();

    const filtered = (await (await pbx('GET', `/xapi/v1/Recordings?${new URLSearchParams({ $filter: 'StartTime ge 2026-08-15T00:00:00Z', $top: '10', $skip: '0' })}`, accessToken)).json()).value;
    expect(filtered.map((r: any) => r.Id)).toEqual([late.Id]);
    expect(filtered[0]).toMatchObject({ IsTranscribed: true, Transcription: 'Hi, this is a test.', Summary: 'Test call.' });

    const download = await pbx('GET', `/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${late.Id})`, accessToken);
    expect(download.status).toBe(200);
    expect(download.headers.get('content-type')).toContain('audio/wav');
    expect(Buffer.from(await download.arrayBuffer()).toString()).toBe('hello-wav');

    const defaultBytes = await pbx('GET', `/xapi/v1/Recordings/Pbx.DownloadRecording(recId=${early.Id})`, accessToken);
    expect((await defaultBytes.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await pbx('GET', '/xapi/v1/Recordings/Pbx.DownloadRecording(recId=999)', accessToken)).status).toBe(404);
  });
});

describe('make call', () => {
  it('T193: Users/Pbx.MakeCall and /callcontrol/:dn/makecall record dn and destination in makecalls', async () => {
    const accessToken = await bearer();
    const viaXapi = await pbx('POST', '/xapi/v1/Users/Pbx.MakeCall', accessToken, { dn: '100', destination: '+15550009999' });
    expect(viaXapi.status).toBe(200);
    const body = await viaXapi.json();
    expect(body).toMatchObject({ finalstatus: 'Success', reason: '', result: { status: 'Dialing', dn: '100', party_caller_id: '+15550009999' } });
    expect(typeof body.result.id).toBe('number');
    expect(typeof body.result.callid).toBe('number');

    const viaCc = await pbx('POST', '/callcontrol/101/makecall', accessToken, { destination: '+15550008888' });
    expect(viaCc.status).toBe(200);

    expect(await state('makecalls')).toMatchObject([
      { dn: '100', destination: '+15550009999', via: 'xapi' },
      { dn: '101', destination: '+15550008888', via: 'callcontrol' },
    ]);
    const participant = await pbx('GET', `/callcontrol/100/participants/${body.result.id}`, accessToken);
    expect((await participant.json()).status).toBe('Dialing');
    expect((await pbx('POST', '/callcontrol/101/makecall', accessToken, {})).status).toBe(400);
  });
});

describe('WebSocket event feed', () => {
  it('T194: the handshake without a bearer is rejected with 401', async () => {
    await expect(connectWs(null)).rejects.toThrow(/401/);
    await expect(connectWs('bogus')).rejects.toThrow(/401/);
  });

  it('T195: pbx-ring pushes an Upsert whose entity resolves to a Ringing participant with party_caller_id', async () => {
    const accessToken = await bearer();
    const { next } = await connectWs(accessToken);

    const rung = await action('pbx-ring', { dn: '100', callerNumber: '+15550001111', callerName: 'Ada' });
    expect(rung.ok).toBe(true);
    const participant = rung.result;
    expect(participant).toMatchObject({ status: 'Ringing', dn: '100', party_caller_id: '+15550001111', party_caller_name: 'Ada' });

    const event = await next();
    expect(event).toMatchObject({ event: { event_type: EVENT_UPSERT, entity: `/callcontrol/100/participants/${participant.id}`, attached_data: null } });
    expect(typeof event.sequence).toBe('number');

    const fetched = await pbx('GET', event.event.entity, accessToken);
    expect(fetched.status).toBe(200);
    expect(await fetched.json()).toMatchObject({ id: participant.id, status: 'Ringing', party_caller_id: '+15550001111', callid: participant.callid });
    expect((await pbx('GET', '/callcontrol/100/participants/999', accessToken)).status).toBe(404);
  });

  it('T228: POST participants/:id/answer connects a ringing participant under direct control and pushes an Upsert', async () => {
    const accessToken = await bearer();
    const { next } = await connectWs(accessToken);

    const rung = await action('pbx-ring', { dn: '100', callerNumber: '+15550002222' });
    expect(rung.result.direct_control).toBe(true);
    await next();

    const answered = await pbx('POST', `/callcontrol/100/participants/${rung.result.id}/answer`, accessToken, {});
    expect(answered.status).toBe(200);
    expect(await answered.json()).toMatchObject({ finalstatus: 'Success', result: { id: rung.result.id, status: 'Connected' } });
    const event = await next();
    expect(event.event).toMatchObject({ event_type: EVENT_UPSERT, entity: `/callcontrol/100/participants/${rung.result.id}` });

    // Already connected: the PBX refuses a second answer.
    expect((await pbx('POST', `/callcontrol/100/participants/${rung.result.id}/answer`, accessToken, {})).status).toBe(422);
    // Wrong extension for the participant.
    expect((await pbx('POST', `/callcontrol/101/participants/${rung.result.id}/answer`, accessToken, {})).status).toBe(404);

    const noControl = await action('pbx-ring', { dn: '100', callerNumber: '+15550003333', directControl: false });
    await next();
    expect((await pbx('POST', `/callcontrol/100/participants/${noControl.result.id}/answer`, accessToken, {})).status).toBe(422);
  });

  it('T196: pbx-answer pushes an Upsert with Connected and pbx-hangup pushes a Remove; sequence climbs', async () => {
    const accessToken = await bearer();
    const { next } = await connectWs(accessToken);
    const participant = (await action('pbx-ring', { dn: '100', callerNumber: '+15550001111' })).result;
    const ring = await next();

    const answered = await action('pbx-answer', { participantId: participant.id });
    expect(answered.result.status).toBe('Connected');
    const answerEvent = await next();
    expect(answerEvent.event).toMatchObject({ event_type: EVENT_UPSERT, entity: ring.event.entity });
    expect(answerEvent.sequence).toBeGreaterThan(ring.sequence);
    expect((await state('participants'))[0].status).toBe('Connected');

    const hung = await action('pbx-hangup', { participantId: participant.id });
    expect(hung.ok).toBe(true);
    const removeEvent = await next();
    expect(removeEvent.event).toMatchObject({ event_type: EVENT_REMOVE, entity: ring.event.entity });
    expect(await state('participants')).toEqual([]);
    expect((await pbx('GET', ring.event.entity, accessToken)).status).toBe(404);

    const missing = await action('pbx-answer', { participantId: participant.id });
    expect(missing.ok).toBe(false);
  });
});

describe('faults', () => {
  it('T198: token-invalid makes the token endpoint answer 401 while armed', async () => {
    await controlPost('/control/threecx/faults/token-invalid/arm');
    expect((await token()).status).toBe(401);
    await controlPost('/control/threecx/faults/token-invalid/disarm');
    expect((await token()).status).toBe(200);
  });

  it('T199: ws-drop closes open sockets once and the next connect succeeds', async () => {
    const accessToken = await bearer();
    const { ws } = await connectWs(accessToken);
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    await controlPost('/control/threecx/faults/ws-drop/arm');
    expect(await closed).toBe(1012);

    const again = await connectWs(accessToken);
    expect(again.ws.readyState).toBe(WebSocket.OPEN);
    await action('pbx-ring', { dn: '100', callerNumber: '+15550001111' });
    expect((await again.next()).event.event_type).toBe(EVENT_UPSERT);
  });
});

describe('catalog', () => {
  it('T200: state views pbx-contacts, makecalls, participants and tokens are listed beside exchanges', async () => {
    const catalog = (await (await fetch(`${control}/control/catalog`)).json()).result;
    const threecx = catalog.emulators.find((emu: any) => emu.id === 'threecx');
    const views = threecx.stateViews.map((v: any) => v.name);
    for (const name of ['exchanges', 'pbx-contacts', 'makecalls', 'participants', 'tokens']) expect(views).toContain(name);
    const seeders = threecx.seeders.map((s: any) => s.name);
    expect(seeders).toEqual(expect.arrayContaining(['pbx-app', 'pbx-user', 'pbx-contact', 'cdr-segment', 'recording']));
    const actions = threecx.actions.map((a: any) => a.name);
    expect(actions).toEqual(expect.arrayContaining(['pbx-ring', 'pbx-answer', 'pbx-hangup', 'crm-create-contact', 'crm-report-chat']));
    expect(threecx.faults.map((f: any) => f.name)).toEqual(expect.arrayContaining(['token-invalid', 'ws-drop']));
  });
});
