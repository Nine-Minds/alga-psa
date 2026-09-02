import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VirtualClock, seededRng } from '@alga-psa/emulator-host';
import type { HostEnv } from '@alga-psa/emulator-host';
import {
  THREECX_API_BASE,
  THREECX_QUERY_PARAMS,
  THREECX_ROUTE_SEGMENTS,
} from '@alga-psa/ee-threecx/lib/routeConstants';
import { ThreecxEmulatorCore } from '../src/core';

const BASE = 'https://app.example.com';
const SLUG = 'abcdef012345';
const KEY = 'the-api-key-1234';

function makeCore(fetchImpl?: any): { core: ThreecxEmulatorCore; calls: any[] } {
  const clock = new VirtualClock();
  const env: HostEnv = { clock, rng: seededRng(1), log: () => {} };
  const core = new ThreecxEmulatorCore(env);
  const calls: any[] = [];
  core.fetchImpl =
    fetchImpl ??
    (async (url: string, init: any) => {
      calls.push({ url, init });
      const status = url.includes(THREECX_ROUTE_SEGMENTS.reportCall) ? 202 : 200;
      const body = status === 202 ? { accepted: true, providerCallId: 'hash-1' } : { contacts: [] };
      return { status, json: async () => body, text: async () => JSON.stringify(body) };
    });
  core.configure({ baseUrl: BASE, tenantSlug: SLUG, apiKey: KEY });
  return { core, calls };
}

describe('ThreecxEmulatorCore', () => {
  it('T117: crm-configure stores the target and the state view masks the key', () => {
    const { core } = makeCore();
    const redacted = core.redactedTarget();
    expect(redacted.baseUrl).toBe(BASE);
    expect(redacted.tenantSlug).toBe(SLUG);
    expect(redacted.apiKey).toBe('••••1234');
    expect(redacted.apiKey).not.toContain(KEY);
  });

  it('T118: crm-inbound-call sends GET lookup with the bearer, then POST report-call, recording both', async () => {
    const { core, calls } = makeCore();
    await core.crmInboundCall({ number: '+15551234567', agentEmail: 'a@x.com', durationSeconds: 30 });

    expect(calls).toHaveLength(2);
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(calls[1].init.method).toBe('POST');
    expect(calls[1].init.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(JSON.parse(calls[1].init.body).callType).toBe('Inbound');

    expect(core.exchanges).toHaveLength(2);
    expect(core.exchanges[0].response.status).toBe(200);
    expect(core.exchanges[1].response.status).toBe(202);
  });

  it('T119: crm-inbound-call with answered false sends callType Missed and durationSeconds 0', async () => {
    const { core, calls } = makeCore();
    await core.crmInboundCall({ number: '+15551234567', agentEmail: 'a@x.com', answered: false, durationSeconds: 30 });
    const body = JSON.parse(calls[1].init.body);
    expect(body.callType).toBe('Missed');
    expect(body.durationSeconds).toBe(0);
  });

  it('T120: crm-outbound-call sends callType Outbound', async () => {
    const { core, calls } = makeCore();
    await core.crmOutboundCall({ number: '+15551234567', agentEmail: 'a@x.com', durationSeconds: 12 });
    expect(JSON.parse(calls[1].init.body).callType).toBe('Outbound');
  });

  it('T121: crm-search sends GET search with the q parameter and records the exchange', async () => {
    const { core, calls } = makeCore();
    await core.crmSearch('acme');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].url).toContain(`${THREECX_QUERY_PARAMS.q}=acme`);
    expect(core.exchanges).toHaveLength(1);
    expect(core.exchanges[0].action).toBe('crm-search');
  });

  it('T122: the exchanges state view lists each request path, method, status and response body', async () => {
    const { core } = makeCore();
    await core.crmInboundCall({ number: '+15551234567', agentEmail: 'a@x.com', durationSeconds: 5 });
    for (const exchange of core.exchanges) {
      expect(typeof exchange.request.method).toBe('string');
      expect(typeof exchange.request.path).toBe('string');
      expect(typeof exchange.response.status).toBe('number');
      expect(exchange.response.body).toBeDefined();
    }
  });

  it('T123: request paths equal the shared route constants (no string literals)', async () => {
    const { core } = makeCore();
    await core.crmInboundCall({ number: '+15551234567', agentEmail: 'a@x.com', durationSeconds: 5 });
    await core.crmSearch('acme');

    const paths = core.exchanges.map((e) => e.request.path);
    expect(paths).toContain(`${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.lookup}`);
    expect(paths).toContain(`${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.reportCall}`);
    expect(paths).toContain(`${THREECX_API_BASE}/${SLUG}/${THREECX_ROUTE_SEGMENTS.search}`);
  });

  it('T116: build-image.sh, compose.yml and the README register threecx on 4070', () => {
    const dir = path.resolve(__dirname, '..', '..');
    const buildImage = fs.readFileSync(path.join(dir, 'build-image.sh'), 'utf8');
    const compose = fs.readFileSync(path.join(dir, 'compose.yml'), 'utf8');
    const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
    expect(buildImage).toMatch(/PACKAGES=\([^)]*\bthreecx\b/);
    expect(compose).toContain('4070:4070');
    expect(readme).toContain('4070');
    expect(readme).toContain('@alga-psa/emulator-threecx');
  });
});
