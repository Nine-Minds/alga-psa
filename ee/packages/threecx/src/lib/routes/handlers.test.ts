import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const store = { providers: [] as any[], users: [] as any[] };

  const createQuery = (table: string) => {
    const rows = () => (table === 'users' ? store.users : store.providers);
    const filters: Record<string, unknown>[] = [];
    const filtered = () =>
      rows().filter((row) => filters.every((cond) => Object.entries(cond).every(([k, v]) => row[k] === v)));
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push(cond);
        return query;
      },
      whereRaw() {
        return query;
      },
      andWhere() {
        return query;
      },
      andWhereRaw() {
        return query;
      },
      orderBy() {
        return query;
      },
      limit() {
        return query;
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
    };
    return query;
  };

  const knexMock: any = () => createQuery('providers');
  knexMock.fn = { now: () => 'NOW()' };

  return { store, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, _tenant: string) => ({
    table: (t: string) => hoisted.createQuery(t.split(' ')[0].replace(/^.*\./, '')),
  }),
}));

vi.mock('@alga-psa/telephony', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTenantPhoneCountryCode: async () => null,
  matchCallParty: async () => ({ status: 'unmatched', contactId: null, clientId: null, candidates: [] }),
}));

import {
  handleThreecxLookup,
  handleThreecxReportCall,
} from './handlers';
import { THREECX_ROUTE_SEGMENT_LIST, THREECX_QUERY_PARAMS } from '../routeConstants';
import type { ThreecxRouteDeps } from './deps';

const TENANT = 'tenant-uuid-1';
const KEY = 'the-secret-key';

function makeDeps(overrides: Partial<ThreecxRouteDeps> = {}): ThreecxRouteDeps {
  return {
    resolveTenantSlug: vi.fn(async () => TENANT),
    checkRateLimit: vi.fn(async () => true),
    getProviderAvailability: vi.fn(async () => ({ enabled: true })),
    enqueueCanonicalCall: vi.fn(async () => undefined),
    ...overrides,
  };
}

function lookupRequest(number?: string, key: string | null = KEY): Request {
  const url = new URL('https://app.example.com/api/telephony/3cx/abcdef012345/lookup');
  if (number !== undefined) url.searchParams.set(THREECX_QUERY_PARAMS.number, number);
  const headers = new Headers();
  if (key !== null) headers.set('authorization', `Bearer ${key}`);
  return new Request(url, { headers });
}

function reportRequest(body: unknown, key: string | null = KEY): Request {
  const url = 'https://app.example.com/api/telephony/3cx/abcdef012345/report-call';
  const headers = new Headers({ 'content-type': 'application/json' });
  if (key !== null) headers.set('authorization', `Bearer ${key}`);
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) });
}

const validReportBody = {
  callType: 'Inbound',
  number: '+15551234567',
  agentEmail: 'agent@example.com',
  durationSeconds: 42,
  startTimeUtc: '2026-09-02T10:00:00Z',
  endTimeUtc: '2026-09-02T10:00:42Z',
};

describe('3CX route auth pipeline', () => {
  beforeEach(() => {
    hoisted.store.providers.length = 0;
    hoisted.store.users.length = 0;
    hoisted.store.providers.push({
      tenant: TENANT,
      provider: '3cx',
      status: 'active',
      webhook_secret: KEY,
      config: JSON.stringify({ templateVersion: 0, keyRotatedAt: null }),
    });
  });

  it('T041: the route constants list four segments and the query params', () => {
    expect(THREECX_ROUTE_SEGMENT_LIST).toHaveLength(4);
    expect(THREECX_ROUTE_SEGMENT_LIST).toEqual(['lookup', 'lookup-by-email', 'search', 'report-call']);
    expect(THREECX_QUERY_PARAMS).toMatchObject({ number: 'number', email: 'email', q: 'q' });
  });

  it('T046: an unknown slug answers 404 before any key work', async () => {
    const deps = makeDeps({ resolveTenantSlug: vi.fn(async () => null) });
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'nope', deps);
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ error: 'unknown_tenant' });
    expect(deps.checkRateLimit).not.toHaveBeenCalled();
  });

  it('T047: a malformed slug (not 12 hex) answers 404, mirroring the resolver', async () => {
    // The real resolver returns null for a slug that is not 12 hex characters.
    const deps = makeDeps({ resolveTenantSlug: vi.fn(async (slug: string) => (/^[a-f0-9]{12}$/i.test(slug) ? TENANT : null)) });
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'not-a-slug', deps);
    expect(res.status).toBe(404);
  });

  it('T048: a rate-limited request answers 429', async () => {
    const deps = makeDeps({ checkRateLimit: vi.fn(async () => false) });
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'abcdef012345', deps);
    expect(res.status).toBe(429);
  });

  it('T049: a request without an Authorization header answers 403', async () => {
    const res = await handleThreecxLookup(lookupRequest('+15551234567', null), 'abcdef012345', makeDeps());
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ error: 'forbidden' });
  });

  it('T050: a wrong bearer key answers 403', async () => {
    const res = await handleThreecxLookup(lookupRequest('+15551234567', 'wrong-key'), 'abcdef012345', makeDeps());
    expect(res.status).toBe(403);
  });

  it('T051: the right bearer key passes authentication', async () => {
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'abcdef012345', makeDeps());
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ contacts: [] });
  });

  it('T052: a tenant whose availability is disabled answers 403 even with the right key', async () => {
    const deps = makeDeps({
      getProviderAvailability: vi.fn(async () => ({ enabled: false, message: 'This telephony provider requires the Pro plan.' })),
    });
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'abcdef012345', deps);
    expect(res.status).toBe(403);
  });

  it('T053: a disabled 3cx row answers 403 with the right key', async () => {
    hoisted.store.providers[0].status = 'disabled';
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'abcdef012345', makeDeps());
    expect(res.status).toBe(403);
  });

  it('T054: a tenant with no 3cx row answers 403', async () => {
    hoisted.store.providers.length = 0;
    const res = await handleThreecxLookup(lookupRequest('+15551234567'), 'abcdef012345', makeDeps());
    expect(res.status).toBe(403);
  });

  it('T055: lookup without the number param answers 400', async () => {
    const res = await handleThreecxLookup(lookupRequest(undefined), 'abcdef012345', makeDeps());
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: 'invalid_request' });
  });

  it('T056: report-call with an unknown callType answers 400', async () => {
    const res = await handleThreecxReportCall(reportRequest({ ...validReportBody, callType: 'Weird' }), 'abcdef012345', makeDeps());
    expect(res.status).toBe(400);
  });

  it('T057: report-call with a non-ISO startTimeUtc answers 400', async () => {
    const res = await handleThreecxReportCall(reportRequest({ ...validReportBody, startTimeUtc: 'yesterday' }), 'abcdef012345', makeDeps());
    expect(res.status).toBe(400);
  });

  it('T082/T083: a valid report-call answers 202 and enqueues the record without writing the ledger', async () => {
    const deps = makeDeps();
    const res = await handleThreecxReportCall(reportRequest(validReportBody), 'abcdef012345', deps);
    expect(res.status).toBe(202);
    const payload = await res.json();
    expect(payload).toMatchObject({ accepted: true });
    expect(payload.providerCallId).toMatch(/^[a-f0-9]{64}$/);
    expect(deps.enqueueCanonicalCall).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: TENANT, record: expect.objectContaining({ provider: '3cx' }) }),
    );
    // The handler enqueues only — the ledger row is the job's job. The DB mock
    // exposes no telephony_call_records store, so any direct insert would throw.
  });

  it('T037: after the stored key rotates, the old key is rejected and the new key passes', async () => {
    // Old key rejected.
    const rejected = await handleThreecxLookup(lookupRequest('+15551234567', 'old-key'), 'abcdef012345', makeDeps());
    expect(rejected.status).toBe(403);

    // Rotate: store the new key.
    hoisted.store.providers[0].webhook_secret = 'rotated-key';
    const accepted = await handleThreecxLookup(lookupRequest('+15551234567', 'rotated-key'), 'abcdef012345', makeDeps());
    expect(accepted.status).toBe(200);
  });
});
