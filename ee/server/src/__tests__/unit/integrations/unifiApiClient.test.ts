import { describe, expect, it, vi } from 'vitest';
import {
  normalizeLocalBaseUrl,
  UniFiApiClient,
  UniFiApiError,
} from '../../../lib/integrations/unifi/unifiApiClient';

const KEY = 'sekret-unifi-key-123';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' }, ...init });
}

function makeClient(responses: Array<Response | Error>, extra: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; headers: Record<string, string> }> = [];
  const queue = [...responses];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url: String(url), headers: init.headers as Record<string, string> });
    const next = queue.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleepImpl = vi.fn(async () => undefined);
  const client = new UniFiApiClient({
    apiKey: KEY,
    fetchImpl: fetchImpl as unknown as typeof fetch,
    sleepImpl,
    ...extra,
  });
  return { client, calls, sleepImpl, fetchImpl };
}

describe('UniFiApiClient', () => {
  it('sends the key only in the X-API-KEY header', async () => {
    const { client, calls } = makeClient([json({ data: [] })]);
    await client.testConnection();
    expect(calls[0].headers['X-API-KEY']).toBe(KEY);
    expect(calls[0].url).not.toContain(KEY);
    expect(calls[0].url).toContain('https://api.ui.com/v1/hosts');
  });

  it('follows nextToken across Site Manager pages without truncating', async () => {
    const { client, calls } = makeClient([
      json({ data: [{ id: 'h1', reportedState: { name: 'One' } }], nextToken: 'tok1' }),
      json({ data: [{ id: 'h2', reportedState: { name: 'Two' } }] }),
    ]);
    const consoles = await client.listConsoles();
    expect(consoles.map((c) => c.hostId)).toEqual(['h1', 'h2']);
    expect(calls[1].url).toContain('nextToken=tok1');
  });

  it('throws instead of returning a partial list when a token repeats', async () => {
    const { client } = makeClient([
      json({ data: [{ id: 'h1' }], nextToken: 'same' }),
      json({ data: [{ id: 'h2' }], nextToken: 'same' }),
    ]);
    await expect(client.listConsoles()).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('pages the Integration API by offset until totalCount is reached', async () => {
    const page = (n: number, offset: number, total: number) => ({
      offset,
      limit: 200,
      count: n,
      totalCount: total,
      data: Array.from({ length: n }, (_, i) => ({ id: `d${offset + i}`, state: 'ONLINE' })),
    });
    const { client, calls } = makeClient([json(page(200, 0, 250)), json(page(50, 200, 250))]);
    const devices = await client.listDevices({ hostId: 'h1', siteId: 's1' });
    expect(devices).toHaveLength(250);
    expect(calls[0].url).toContain('/v1/connector/consoles/h1/proxy/network/integration/v1/sites/s1/devices');
    expect(calls[1].url).toContain('offset=200');
  });

  it('fails when a later page errors rather than returning the first page', async () => {
    const { client } = makeClient([
      json({ offset: 0, limit: 200, count: 200, totalCount: 400, data: Array.from({ length: 200 }, (_, i) => ({ id: `d${i}` })) }),
      json({ message: 'boom' }, { status: 500 }),
    ]);
    await expect(client.listDevices({ hostId: 'h1', siteId: 's1' })).rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  it('fails when an empty page arrives before totalCount', async () => {
    const { client } = makeClient([json({ offset: 0, limit: 200, count: 0, totalCount: 5, data: [] })]);
    await expect(client.listDevices({ hostId: 'h1', siteId: 's1' })).rejects.toMatchObject({ kind: 'invalid_response' });
  });

  it('honors Retry-After on 429 and retries', async () => {
    const { client, sleepImpl } = makeClient([
      new Response('slow down', { status: 429, headers: { 'retry-after': '7' } }),
      json({ data: [] }),
    ]);
    await client.testConnection();
    expect(sleepImpl).toHaveBeenCalledWith(7000);
  });

  it('caps the Retry-After wait', async () => {
    const { client, sleepImpl } = makeClient([
      new Response('', { status: 429, headers: { 'retry-after': '9999' } }),
      json({ data: [] }),
    ]);
    await client.testConnection();
    expect(sleepImpl).toHaveBeenCalledWith(30_000);
  });

  it('stops retrying after the bounded number of attempts', async () => {
    const rate = () => new Response('', { status: 429, headers: { 'retry-after': '1' } });
    const { client, fetchImpl } = makeClient([rate(), rate(), rate(), rate(), rate()]);
    await expect(client.testConnection()).rejects.toMatchObject({ kind: 'rate_limited', status: 429 });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403])('maps %i to an auth error and notifies onAuthFailure', async (status) => {
    const onAuthFailure = vi.fn();
    const { client } = makeClient([new Response(`bad key ${KEY}`, { status })], { onAuthFailure });
    const error = await client.testConnection().catch((e) => e);
    expect(error).toBeInstanceOf(UniFiApiError);
    expect(error.kind).toBe('auth');
    expect(onAuthFailure).toHaveBeenCalledWith(status);
    expect(error.message).not.toContain(KEY);
  });

  it('never leaks the key through error messages', async () => {
    const { client } = makeClient([new Response(`upstream echoed ${KEY} back`, { status: 502 })]);
    const error = await client.testConnection().catch((e) => e);
    expect(error.message).not.toContain(KEY);
    expect(error.message).toContain('[redacted]');

    const net = makeClient([new Error(`connect failed for ${KEY}`)]);
    const netError = await net.client.testConnection().catch((e) => e);
    expect(netError.kind).toBe('network');
    expect(netError.message).not.toContain(KEY);
  });

  it('uses the controller directly in local mode with no connector prefix', async () => {
    const { client, calls } = makeClient([json({ data: [{ id: 's1', name: 'HQ' }], totalCount: 1 })], {
      mode: 'local',
      localBaseUrl: 'https://192.168.1.1/some/path',
    });
    const { sites } = await client.listSites();
    expect(sites).toEqual([{ hostId: 'local', hostName: 'Local controller', siteId: 's1', name: 'HQ' }]);
    expect(calls[0].url.startsWith('https://192.168.1.1/proxy/network/integration/v1/sites')).toBe(true);
  });

  it('reports a failed console in failures without aborting the others', async () => {
    const { client } = makeClient([
      json({ data: [{ id: 'h1', reportedState: { name: 'A' } }, { id: 'h2', reportedState: { name: 'B' } }] }),
      json({ message: 'down' }, { status: 502 }),
      json({ offset: 0, limit: 200, count: 1, totalCount: 1, data: [{ id: 's9', name: 'Site' }] }),
    ]);
    const { sites, failures } = await client.listSites();
    expect(sites.map((s) => s.hostId)).toEqual(['h2']);
    expect(failures.map((f) => f.hostId)).toEqual(['h1']);
  });

  it('parses a device defensively', async () => {
    const { client } = makeClient([
      json({ id: 'd1', macAddress: 'AA:BB:CC:00:11:22', model: 'USW-24', state: 'ONLINE', features: { switching: {} }, uplink: { deviceId: 'u1' } }),
    ]);
    const device = await client.getDevice({ hostId: 'h1', siteId: 's1' }, 'd1');
    expect(device).toMatchObject({ id: 'd1', features: ['switching'], uplinkDeviceId: 'u1', serialNumber: null });
  });
});

describe('normalizeLocalBaseUrl', () => {
  it('keeps only the origin', () => {
    expect(normalizeLocalBaseUrl('https://unifi.example.com:8443/x?y=1')).toBe('https://unifi.example.com:8443');
  });
  it.each(['ftp://x.example.com', 'https://user:pw@x.example.com', 'http://localhost:8080', 'http://127.0.0.1', 'http://169.254.169.254', 'not a url'])(
    'rejects %s',
    (value) => {
      expect(() => normalizeLocalBaseUrl(value)).toThrow(UniFiApiError);
    }
  );
});
