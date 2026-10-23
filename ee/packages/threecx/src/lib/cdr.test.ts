import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const state = { rows: [] as any[], users: [] as any[], calls: [] as any[] };
  const createQuery = (rows: any[]) => {
    const preds: Array<(row: any) => boolean> = [];
    const filtered = () => rows.filter((row) => preds.every((p) => p(row)));
    const query: any = {
      where(a: any, b?: any) {
        if (typeof a === 'function') {
          const sub = createQuery(rows);
          a(sub);
          preds.push((row) => sub._matches(row));
        } else if (typeof a === 'object') {
          preds.push((row) => Object.entries(a).every(([k, v]) => row[k] === v));
        } else {
          preds.push((row) => row[a] === b);
        }
        return query;
      },
      orWhere(col: string, value: unknown) {
        const prev = preds.pop() ?? (() => false);
        preds.push((row) => prev(row) || row[col] === value);
        return query;
      },
      whereBetween(col: string, [lo, hi]: [string, string]) {
        preds.push((row) => {
          const v = new Date(row[col]).getTime();
          return v >= new Date(lo).getTime() && v <= new Date(hi).getTime();
        });
        return query;
      },
      whereRaw(_sql: string, binds: unknown[]) {
        preds.push((row) => String(row.email ?? '').toLowerCase() === binds[0]);
        return query;
      },
      _matches(row: any) {
        return preds.every((p) => p(row));
      },
      async first() {
        const [row] = filtered();
        return row ? { ...row } : undefined;
      },
      async select() {
        return filtered().map((row) => ({ ...row }));
      },
      async update(values: Record<string, unknown>) {
        const rows = filtered();
        rows.forEach((row) => Object.assign(row, values));
        return rows.length;
      },
    };
    return query;
  };
  const tables: Record<string, any[]> = {
    telephony_providers: state.rows,
    users: state.users,
    telephony_call_records: state.calls,
  };
  const knexMock: any = () => createQuery(state.rows);
  knexMock.fn = { now: () => 'NOW()' };
  return { state, tables, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: (name: string) => hoisted.createQuery(hoisted.tables[name]).where({ tenant }),
  }),
}));
vi.mock('@alga-psa/core', () => ({ enqueueImmediateJob: vi.fn() }));
vi.mock('@alga-psa/core/secrets', () => ({
  getSecretProviderInstance: async () => ({ getAppSecret: async () => undefined, getTenantSecret: async () => 'shh' }),
}));
vi.mock('@alga-psa/event-bus', () => ({ getRedisConfig: () => ({ url: 'redis://x', prefix: 'alga-psa:' }) }));
vi.mock('@alga-psa/telephony', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTenantPhoneCountryCode: async () => 'US',
}));

import { canonicalCallRecordSchema, type CanonicalCallRecord } from '@alga-psa/telephony/types';
import {
  backfillThreecxCdr,
  isDuplicateThreecxCall,
  mapCallHistorySegment,
  parseIsoDurationSeconds,
  setThreecxCallHistoryImport,
  THREECX_CANONICAL_CALL_JOB,
  threecxUnmappedAgentEmail,
  type MapCallHistoryContext,
  type ThreecxCallHistorySegment,
} from './cdr';
import { parseThreecxConfig } from './providerState';
import { buildThreecxCanonicalCall, threecxProviderCallId } from './reportCall';

const TENANT = 'tenant-1';
const NOW = new Date('2026-09-15T00:00:00Z');

const ctx: MapCallHistoryContext = {
  extensions: [{ dn: '101', pbxDisplayName: 'Agent', pbxEmail: 'agent@example.com', userId: 'u1', mappedBy: 'auto' }],
  usersById: new Map([['u1', { email: 'agent@example.com' }]]),
  defaultCountryCode: 'US',
};

function segment(overrides: Partial<ThreecxCallHistorySegment> = {}): ThreecxCallHistorySegment {
  return {
    SegmentId: 1,
    SegmentType: 'Trunk',
    SegmentStartTime: '2026-09-10T12:00:00Z',
    SegmentEndTime: '2026-09-10T12:01:35Z',
    CallTime: 'PT1M35S',
    CallAnswered: true,
    SrcDn: '15551234567',
    SrcCallerNumber: '+15551234567',
    SrcDisplayName: 'Caller',
    SrcExternal: true,
    SrcInternal: false,
    DstDn: '101',
    DstCallerNumber: '101',
    DstDisplayName: 'Agent',
    DstExternal: false,
    DstInternal: true,
    ...overrides,
  };
}

function outboundSegment(overrides: Partial<ThreecxCallHistorySegment> = {}): ThreecxCallHistorySegment {
  return segment({
    SegmentId: 2,
    SrcDn: '101',
    SrcCallerNumber: '101',
    SrcExternal: false,
    SrcInternal: true,
    DstDn: '5559876543',
    DstCallerNumber: '5559876543',
    DstExternal: true,
    DstInternal: false,
    ...overrides,
  });
}

function seedProvider(cdr: Record<string, unknown> = {}, pbx: Record<string, unknown> = {}) {
  hoisted.state.rows.push({
    tenant: TENANT,
    provider: '3cx',
    provider_id: 'p1',
    status: 'active',
    webhook_secret: 'key',
    config: JSON.stringify({
      pbx: { baseUrl: 'https://pbx.example.com', clientId: '900', clientSecretRef: 'ref', status: 'connected', capabilities: { xapi: true, callControl: false }, ...pbx },
      extensions: ctx.extensions,
      cdr: { enabled: true, lookbackDays: 30, watermark: null, ...cdr },
    }),
  });
  hoisted.state.users.push({ tenant: TENANT, user_id: 'u1', email: 'agent@example.com', user_type: 'internal' });
}

function fakeClient(segments: ThreecxCallHistorySegment[]) {
  const xapiGet = vi.fn(async (_path: string, query: Record<string, unknown> = {}) => {
    const from = new Date(String(query.$filter).replace('SegmentStartTime ge ', '')).getTime();
    const matching = segments
      .filter((s) => new Date(s.SegmentStartTime).getTime() >= from)
      .sort((a, b) => a.SegmentStartTime.localeCompare(b.SegmentStartTime));
    const skip = Number(query.$skip ?? 0);
    const top = Number(query.$top ?? 200);
    return { value: matching.slice(skip, skip + top) };
  });
  return { client: { baseUrl: 'https://pbx.example.com', xapiGet } as any, xapiGet };
}

/** Stands in for the canonical-call job: writes the ledger row the next run dedupes against. */
function fakeEnqueue() {
  const enqueued: Array<{ jobName: string; data: { tenantId: string; record: CanonicalCallRecord } }> = [];
  const enqueue = vi.fn(async (jobName: string, data: { tenantId: string; record: CanonicalCallRecord }) => {
    enqueued.push({ jobName, data });
    const r = data.record;
    hoisted.state.calls.push({
      tenant: data.tenantId,
      call_record_id: `c${hoisted.state.calls.length + 1}`,
      provider: r.provider,
      provider_call_id: r.providerCallId,
      direction: r.direction,
      caller_number_e164: r.callerNumber?.e164 ?? null,
      callee_number_e164: r.calleeNumber?.e164 ?? null,
      organizer_user_id: r.organizerUserId ?? null,
      started_at: r.startedAt,
    });
  });
  return { enqueue, enqueued };
}

function currentConfig() {
  return parseThreecxConfig(hoisted.state.rows[0].config);
}

describe('3CX call-history backfill', () => {
  beforeEach(() => {
    hoisted.state.rows.length = 0;
    hoisted.state.users.length = 0;
    hoisted.state.calls.length = 0;
  });

  it('T080: parseThreecxConfig defaults cdr to disabled with a 30-day lookback', () => {
    expect(parseThreecxConfig({}).cdr).toEqual({ enabled: false, lookbackDays: 30, watermark: null, lastRunAt: null, lastRunAdded: 0 });
  });

  it('T090: parses ISO 8601 and clock durations', () => {
    expect(parseIsoDurationSeconds('PT1M35S')).toBe(95);
    expect(parseIsoDurationSeconds('PT1H')).toBe(3600);
    expect(parseIsoDurationSeconds('PT0S')).toBe(0);
    expect(parseIsoDurationSeconds('P1DT2S')).toBe(86402);
    expect(parseIsoDurationSeconds('00:01:35')).toBe(95);
    expect(parseIsoDurationSeconds('garbage')).toBe(0);
    expect(parseIsoDurationSeconds(undefined)).toBe(0);
  });

  it('T086/T089/F058: external source maps to inbound with the caller number, agent and timing from the segment', () => {
    const record = mapCallHistorySegment(segment(), ctx)!;
    expect(canonicalCallRecordSchema.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({
      provider: '3cx',
      direction: 'inbound',
      callerNumber: { raw: '+15551234567', e164: '+15551234567' },
      organizerUserId: 'u1',
      startedAt: '2026-09-10T12:00:00.000Z',
      endedAt: '2026-09-10T12:01:35.000Z',
      durationSeconds: 95,
      modality: 'audio',
    });
    expect(record.calleeNumber).toBeUndefined();
    expect(record.raw?.SegmentId).toBe(1);
    expect(record.providerCallId).toBe(
      threecxProviderCallId({ agentEmail: 'agent@example.com', numberForHash: '+15551234567', callType: 'Inbound', startTimeUtc: '2026-09-10T12:00:00Z' }),
    );
  });

  it('T087: external destination maps to outbound with the normalized callee number', () => {
    const record = mapCallHistorySegment(outboundSegment(), ctx)!;
    expect(record).toMatchObject({
      direction: 'outbound',
      calleeNumber: { raw: '5559876543', e164: '+15559876543' },
      organizerUserId: 'u1',
      durationSeconds: 95,
    });
    expect(record.callerNumber).toBeUndefined();
    expect(record.providerCallId).toBe(
      threecxProviderCallId({ agentEmail: 'agent@example.com', numberForHash: '+15559876543', callType: 'Outbound', startTimeUtc: '2026-09-10T12:00:00Z' }),
    );
  });

  it('T088: unanswered inbound maps to missed with duration 0', () => {
    const record = mapCallHistorySegment(segment({ CallAnswered: false }), ctx)!;
    expect(record.direction).toBe('missed');
    expect(record.durationSeconds).toBe(0);
    expect(record.callerNumber).toEqual({ raw: '+15551234567', e164: '+15551234567' });
    expect(record.providerCallId).toBe(
      threecxProviderCallId({ agentEmail: 'agent@example.com', numberForHash: '+15551234567', callType: 'Missed', startTimeUtc: '2026-09-10T12:00:00Z' }),
    );
  });

  it('T085: a segment with no external party is skipped', () => {
    expect(mapCallHistorySegment(segment({ SrcExternal: false, SrcInternal: true, SrcDn: '102' }), ctx)).toBeNull();
    expect(mapCallHistorySegment(outboundSegment({ SrcExternal: true }), ctx)).toBeNull();
  });

  it('T089: an unmapped extension hashes under a synthetic agent identity with no organizer', () => {
    const record = mapCallHistorySegment(segment({ DstDn: '102' }), ctx)!;
    expect(record.organizerUserId).toBeNull();
    expect(record.providerCallId).toBe(
      threecxProviderCallId({ agentEmail: threecxUnmappedAgentEmail('102'), numberForHash: '+15551234567', callType: 'Inbound', startTimeUtc: '2026-09-10T12:00:00Z' }),
    );
  });

  it('T091: the hash truncates the start to whole seconds', () => {
    const base = { agentEmail: 'agent@example.com', numberForHash: '+15551234567', callType: 'Inbound' as const };
    expect(threecxProviderCallId({ ...base, startTimeUtc: '2026-09-10T12:00:00.000Z' })).toBe(
      threecxProviderCallId({ ...base, startTimeUtc: '2026-09-10T12:00:00.999Z' }),
    );
  });

  it('T092: report-call and the backfill hash the same call identically', async () => {
    hoisted.state.users.push({ tenant: TENANT, user_id: 'u1', email: 'agent@example.com', user_type: 'internal' });
    const reported = await buildThreecxCanonicalCall(
      { tenantId: TENANT, defaultCountryCode: 'US' },
      {
        callType: 'Inbound',
        number: '5551234567',
        agentEmail: 'AGENT@example.com',
        durationSeconds: 95,
        startTimeUtc: '2026-09-10T12:00:00.250Z',
        endTimeUtc: '2026-09-10T12:01:35.250Z',
      },
    );
    const backfilled = mapCallHistorySegment(segment(), ctx)!;
    expect(backfilled.providerCallId).toBe(reported.providerCallId);
    expect(backfilled.organizerUserId).toBe(reported.organizerUserId);
  });

  it('T093: a segment whose hash already exists is a duplicate', async () => {
    const record = mapCallHistorySegment(segment(), ctx)!;
    hoisted.state.calls.push({ tenant: TENANT, call_record_id: 'c1', provider: '3cx', provider_call_id: record.providerCallId });
    const db = { table: (name: string) => hoisted.createQuery(hoisted.tables[name]).where({ tenant: TENANT }) } as any;
    expect(await isDuplicateThreecxCall(db, record)).toBe(true);
    hoisted.state.calls[0].tenant = 'other-tenant';
    expect(await isDuplicateThreecxCall(db, record)).toBe(false);
  });

  it('T094/T095: same agent and number within 60 s is a duplicate; 90 s apart is not', async () => {
    const record = mapCallHistorySegment(segment(), ctx)!;
    const db = { table: (name: string) => hoisted.createQuery(hoisted.tables[name]).where({ tenant: TENANT }) } as any;
    const seed = (startedAt: string) => {
      hoisted.state.calls.length = 0;
      hoisted.state.calls.push({
        tenant: TENANT,
        call_record_id: 'c1',
        provider: '3cx',
        provider_call_id: 'template-hash',
        organizer_user_id: 'u1',
        caller_number_e164: '+15551234567',
        callee_number_e164: null,
        started_at: startedAt,
      });
    };
    seed('2026-09-10T11:59:15Z');
    expect(await isDuplicateThreecxCall(db, record)).toBe(true);
    seed('2026-09-10T11:58:30Z');
    expect(await isDuplicateThreecxCall(db, record)).toBe(false);
    seed('2026-09-10T11:59:15Z');
    expect(await isDuplicateThreecxCall(db, { ...record, organizerUserId: null })).toBe(false);
  });

  it('does nothing unless enabled, connected and xapi-capable', async () => {
    seedProvider({ enabled: false });
    const { client, xapiGet } = fakeClient([segment()]);
    expect(await backfillThreecxCdr(TENANT, { client, now: NOW })).toEqual({ scanned: 0, added: 0, skipped: 0, watermark: null });
    hoisted.state.rows.length = 0;
    hoisted.state.users.length = 0;
    seedProvider({}, { status: 'error' });
    expect(await backfillThreecxCdr(TENANT, { client, now: NOW })).toEqual({ scanned: 0, added: 0, skipped: 0, watermark: null });
    hoisted.state.rows.length = 0;
    hoisted.state.users.length = 0;
    seedProvider({}, { capabilities: { xapi: false, callControl: true } });
    expect(await backfillThreecxCdr(TENANT, { client, now: NOW })).toEqual({ scanned: 0, added: 0, skipped: 0, watermark: null });
    expect(xapiGet).not.toHaveBeenCalled();
  });

  it('T083: the first run queries from now minus lookbackDays, later runs from the watermark', async () => {
    seedProvider({ lookbackDays: 30 });
    const { client, xapiGet } = fakeClient([]);
    await backfillThreecxCdr(TENANT, { client, now: NOW, enqueue: fakeEnqueue().enqueue });
    expect(xapiGet).toHaveBeenCalledWith('/CallHistoryView', {
      $filter: 'SegmentStartTime ge 2026-08-16T00:00:00.000Z',
      $orderby: 'SegmentStartTime asc',
      $top: 200,
      $skip: 0,
    });

    hoisted.state.rows.length = 0;
    hoisted.state.users.length = 0;
    seedProvider({ watermark: '2026-09-14T22:55:00.000Z' });
    xapiGet.mockClear();
    await backfillThreecxCdr(TENANT, { client, now: NOW, enqueue: fakeEnqueue().enqueue });
    expect(xapiGet.mock.calls[0][1]).toMatchObject({ $filter: 'SegmentStartTime ge 2026-09-14T22:55:00.000Z' });
  });

  it('T084: pages with $top=200 and $skip until a short page', async () => {
    seedProvider();
    const segments = Array.from({ length: 205 }, (_, i) =>
      segment({ SegmentId: i, SegmentStartTime: new Date(Date.UTC(2026, 8, 10, 12, 0, i)).toISOString() }),
    );
    const { client, xapiGet } = fakeClient(segments);
    const result = await backfillThreecxCdr(TENANT, { client, now: NOW, enqueue: fakeEnqueue().enqueue });
    expect(xapiGet).toHaveBeenCalledTimes(2);
    expect(xapiGet.mock.calls.map((c) => c[1]?.$skip)).toEqual([0, 200]);
    expect(result.scanned).toBe(205);
  });

  it('T096/T097/T098: survivors are enqueued, the run is recorded, the watermark lags 5 minutes, and a rerun adds nothing', async () => {
    seedProvider();
    const segments = [
      segment({ SegmentId: 1, SegmentStartTime: '2026-09-10T12:00:00Z' }),
      outboundSegment({ SegmentId: 2, SegmentStartTime: '2026-09-10T12:02:00Z' }),
      segment({ SegmentId: 3, SegmentStartTime: '2026-09-10T12:03:00Z', SrcExternal: false, SrcInternal: true, SrcDn: '102' }),
    ];
    const { client } = fakeClient(segments);
    const { enqueue, enqueued } = fakeEnqueue();

    const first = await backfillThreecxCdr(TENANT, { client, now: NOW, enqueue });
    expect(first).toEqual({ scanned: 3, added: 2, skipped: 1, watermark: '2026-09-10T11:58:00.000Z' });
    expect(enqueued.map((e) => e.jobName)).toEqual([THREECX_CANONICAL_CALL_JOB, THREECX_CANONICAL_CALL_JOB]);
    expect(enqueued[0].data).toMatchObject({ tenantId: TENANT, record: { direction: 'inbound', organizerUserId: 'u1' } });
    expect(enqueued[1].data.record.direction).toBe('outbound');
    expect(currentConfig().cdr).toMatchObject({ lastRunAt: NOW.toISOString(), lastRunAdded: 2, watermark: '2026-09-10T11:58:00.000Z' });

    const later = new Date('2026-09-15T01:00:00Z');
    const second = await backfillThreecxCdr(TENANT, { client, now: later, enqueue });
    expect(second).toEqual({ scanned: 3, added: 0, skipped: 3, watermark: '2026-09-10T11:58:00.000Z' });
    expect(enqueued).toHaveLength(2);
    expect(currentConfig().cdr).toMatchObject({ lastRunAt: later.toISOString(), lastRunAdded: 0 });
  });

  it('skips a segment the template already reported with a slightly different start', async () => {
    seedProvider();
    hoisted.state.calls.push({
      tenant: TENANT,
      call_record_id: 'c1',
      provider: '3cx',
      provider_call_id: 'template-hash',
      organizer_user_id: 'u1',
      caller_number_e164: '+15551234567',
      callee_number_e164: null,
      started_at: '2026-09-10T12:00:20Z',
    });
    const { client } = fakeClient([segment()]);
    const { enqueue } = fakeEnqueue();
    expect(await backfillThreecxCdr(TENANT, { client, now: NOW, enqueue })).toMatchObject({ scanned: 1, added: 0, skipped: 1 });
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('F053: setThreecxCallHistoryImport validates lookbackDays and resets the watermark on enable', async () => {
    seedProvider({ enabled: false, watermark: '2026-09-01T00:00:00.000Z' });
    await expect(setThreecxCallHistoryImport(TENANT, { enabled: true, lookbackDays: 0 })).rejects.toThrow(/lookbackDays/);
    await expect(setThreecxCallHistoryImport(TENANT, { enabled: true, lookbackDays: 366 })).rejects.toThrow(/lookbackDays/);
    await expect(setThreecxCallHistoryImport(TENANT, { enabled: true, lookbackDays: 1.5 })).rejects.toThrow(/lookbackDays/);

    let state = await setThreecxCallHistoryImport(TENANT, { enabled: true, lookbackDays: 7 });
    expect(state.cdr).toMatchObject({ enabled: true, lookbackDays: 7, watermark: null });

    hoisted.state.rows[0].config = JSON.stringify({ ...currentConfig(), cdr: { ...currentConfig().cdr, watermark: '2026-09-14T00:00:00.000Z' } });
    state = await setThreecxCallHistoryImport(TENANT, { enabled: false });
    expect(state.cdr).toMatchObject({ enabled: false, lookbackDays: 7, watermark: '2026-09-14T00:00:00.000Z' });
  });
});
