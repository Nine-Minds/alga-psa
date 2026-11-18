/**
 * Alga's real HuntressClient against the algasim Huntress emulator, over HTTP.
 *
 * The emulator package knows nothing about the product: an import of ee/server
 * from packages/emulators/huntress would make the Nx project graph circular.
 * So the consumer-side check lives here — the wrapped `/v1/account` body,
 * `page_token` pagination, the exact list parameters the client sends, 404 →
 * null, and its 429/5xx handling. The vendor wire contract itself is covered by
 * packages/emulators/huntress/tests/{rest,escalations}.test.ts.
 *
 * Requests reach the emulator through a recording proxy, so the query strings
 * the client builds are asserted directly (the host request journal
 * deliberately omits query strings).
 */

import http from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmulatorHost } from '@alga-psa/emulator-host';
import huntress, { type HuntressEmulatorCore } from '@alga-psa/emulator-huntress';

// createHuntressClient imports the secrets provider and the tenant Knex helper
// at module load; the client under test is constructed directly.
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getTenantSecret: async () => undefined }),
}));
vi.mock('@/lib/db', () => ({
  createTenantKnex: async () => ({ knex: null, tenant: null }),
}));

const { HuntressClient } = await import('../../lib/integrations/huntress/huntressClient');

const API_KEY = 'algasim-huntress-key';
const API_SECRET = 'algasim-huntress-secret';

let host: EmulatorHost;
let control: string;
let vendor: string;
let core: HuntressEmulatorCore;
let proxy: { url: string; requests: string[]; close: () => Promise<void> };
let sleeps: number[] = [];

async function callControl(kind: 'seed' | 'actions', name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/huntress/${kind}/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  const json = (await response.json()) as { ok: boolean; result?: any; error?: string };
  if (!json.ok) throw new Error(`${kind}/${name} failed: ${json.error}`);
  return json.result;
}

const seed = (name: string, params?: unknown) => callControl('seed', name, params);
const action = (name: string, params?: unknown) => callControl('actions', name, params);

async function arm(name: string, params: unknown = {}) {
  const response = await fetch(`${control}/control/huntress/faults/${name}/arm`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (response.status !== 200) throw new Error(`arm ${name} failed: ${await response.text()}`);
}

/** Records every request URL and forwards it (GET only — the client only reads). */
async function startRecordingProxy(target: string) {
  const requests: string[] = [];
  const server = http.createServer(async (req, res) => {
    requests.push(req.url ?? '');
    const upstream = await fetch(`${target}${req.url}`, {
      method: req.method,
      headers: { authorization: String(req.headers.authorization ?? ''), accept: 'application/json' },
    });
    const body = await upstream.text();
    const retryAfter = upstream.headers.get('retry-after');
    res.writeHead(upstream.status, {
      'content-type': 'application/json',
      ...(retryAfter ? { 'retry-after': retryAfter } : {}),
    });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    requests,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function client(apiKey = API_KEY, apiSecret = API_SECRET) {
  return new HuntressClient({
    apiKey,
    apiSecret,
    baseUrl: proxy.url,
    // The 1.1s request spacing is the client's rate-limit budget, not part of
    // what is under test here; the recorded sleeps are backoffs only.
    minRequestIntervalMs: 0,
    sleep: async (ms: number) => {
      sleeps.push(ms);
    },
  });
}

beforeAll(async () => {
  host = new EmulatorHost({ emulators: [huntress], controlPort: 0, ports: { huntress: 0 } });
  const { controlPort, ports } = await host.start();
  control = `http://127.0.0.1:${controlPort}`;
  vendor = `http://127.0.0.1:${ports.huntress}`;
  core = host.instance('huntress').core as HuntressEmulatorCore;
  proxy = await startRecordingProxy(vendor);
});

afterAll(async () => {
  await proxy.close();
  await host.stop();
});

beforeEach(async () => {
  await fetch(`${control}/control/huntress/reset`, { method: 'POST' });
  proxy.requests.length = 0;
  sleeps = [];
});

describe('HuntressClient against the Huntress emulator', () => {
  it('getAccount returns the documented { account } envelope — which the client does not unwrap', async () => {
    await action('configure', { accountName: 'Acme MSP', accountSubdomain: 'acme' });

    const account = (await client().getAccount()) as unknown as Record<string, unknown>;
    expect(proxy.requests).toEqual(['/v1/account']);
    // Huntress documents `{ "account": { ... } }` and the emulator serves it.
    expect(account.account).toMatchObject({ id: 1, name: 'Acme MSP', subdomain: 'acme', status: 'enabled' });
    // …so the fields connectHuntress stores as accountName/accountSubdomain are
    // undefined on the value the client hands back. That is live consumer drift
    // (PROTOCOL_PARITY.md "Huntress → Consumer drift"): flip these two
    // assertions when the client unwraps `{ account }`.
    expect(account.name).toBeUndefined();
    expect(account.subdomain).toBeUndefined();

    await expect(client('wrong-key', API_SECRET).getAccount()).rejects.toMatchObject({
      response: { status: 403 },
    });
  });

  it('listOrganizations walks every page with limit=500 + page_token', async () => {
    await seed('organization', { name: 'Site', count: 501 });

    const organizations = await client().listOrganizations();
    expect(organizations).toHaveLength(501);
    expect(new Set(organizations.map((o) => o.id)).size).toBe(501);
    // 501 organizations at the documented maximum page size is exactly two
    // requests, the second carrying the first page's token.
    expect(proxy.requests).toHaveLength(2);
    expect(proxy.requests[0]).toBe('/v1/organizations?limit=500');
    expect(proxy.requests[1]).toMatch(/^\/v1\/organizations\?limit=500&page_token=.+$/);
    expect(organizations[0]).toMatchObject({ name: expect.any(String), key: expect.any(String) });
  });

  it('getOrganization and getAgent answer null on a 404 and propagate anything else', async () => {
    const org = (await seed('organization', { name: 'Acme Inc.', key: 'acme' })).organizations[0];
    const agent = (await seed('agent', { hostname: 'SRV01', organization_id: org.id, ipv4_address: '10.0.0.5' })).agent;

    expect(await client().getOrganization(org.id)).toMatchObject({ id: org.id, name: 'Acme Inc.', key: 'acme' });
    expect(await client().getAgent(agent.id)).toMatchObject({
      id: agent.id,
      hostname: 'SRV01',
      ipv4_address: '10.0.0.5',
    });

    expect(await client().getOrganization(4242)).toBeNull();
    expect(await client().getAgent(4242)).toBeNull();

    // An agent that dropped off Huntress reads as "no asset detail", not an error.
    await action('delete-agent', { agentId: agent.id });
    expect(await client().getAgent(agent.id)).toBeNull();

    await arm('operation-fault', { operation: 'GET /v1/agents/*', status: 500, message: 'Internal Server Error' });
    await expect(client().getAgent(agent.id)).rejects.toMatchObject({ response: { status: 500 } });
  });

  it('listIncidentReportsPage sends the documented cursor parameters and gets updated_at desc', async () => {
    const org = (await seed('organization', { name: 'Acme Inc.' })).organizations[0];
    const ids: number[] = [];
    for (let index = 0; index < 3; index += 1) {
      ids.push((await seed('incident', { organization_id: org.id, severity: 'high' })).incident_report.id);
      host.clock.advance('10m');
    }
    // The oldest report is updated last, so updated_at desc and id desc differ.
    await action('touch-incident', { incidentId: ids[0] });

    const page = await client().listIncidentReportsPage();
    expect(proxy.requests).toEqual(['/v1/incident_reports?limit=500&sort_field=updated_at&sort_direction=desc']);
    expect(page.incident_reports.map((incident) => incident.id)).toEqual([ids[0], ids[2], ids[1]]);
    expect(page.pagination?.next_page_token ?? null).toBeNull();
    expect(page.incident_reports[0]).toMatchObject({
      account_id: 1,
      organization_id: org.id,
      severity: 'high',
      status: 'sent',
      remediations: { total_count: 0, has_more: false, items: [] },
    });

    proxy.requests.length = 0;
    const firstOfOne = await client().listIncidentReportsPage({ limit: 1 });
    const token = firstOfOne.pagination?.next_page_token;
    expect(token).toEqual(expect.any(String));
    const second = await client().listIncidentReportsPage({ limit: 1, page_token: token! });
    expect(proxy.requests[1]).toBe(
      `/v1/incident_reports?limit=1&sort_field=updated_at&sort_direction=desc&page_token=${encodeURIComponent(token!)}`,
    );
    expect(second.incident_reports.map((incident) => incident.id)).toEqual([ids[2]]);
    expect(core.incidents.get(ids[0])!.updated_at).toBe(firstOfOne.incident_reports[0].updated_at);
  });

  it('retries a 429 twice honoring Retry-After, then propagates the third', async () => {
    const org = (await seed('organization', { name: 'Acme Inc.' })).organizations[0];
    await seed('incident', { organization_id: org.id });

    await arm('rate-limit', { remaining: 2, retryAfterSeconds: 3 });
    const page = await client().listIncidentReportsPage();
    expect(page.incident_reports).toHaveLength(1);
    // Retry-After is seconds; the client waits that long rather than its 10s default.
    expect(sleeps).toEqual([3000, 3000]);
    expect(proxy.requests).toHaveLength(3);

    sleeps = [];
    await arm('rate-limit', { remaining: 3, retryAfterSeconds: 0 });
    // MAX_RATE_LIMIT_RETRIES is 2, so the third 429 surfaces.
    await expect(client().listIncidentReportsPage()).rejects.toMatchObject({ response: { status: 429 } });
    expect(sleeps).toEqual([10_000, 10_000]); // Retry-After: 0 is not usable, so the default backoff
  });

  it('propagates a 5xx on the incident list', async () => {
    await arm('operation-fault', {
      operation: 'GET /v1/incident_reports',
      status: 503,
      message: 'Service Unavailable',
    });
    await expect(client().listIncidentReportsPage()).rejects.toMatchObject({ response: { status: 503 } });
    expect(sleeps).toEqual([]); // a 5xx is not retried by the client
    await expect(client().listIncidentReportsPage()).resolves.toMatchObject({ incident_reports: [] });
  });
});
