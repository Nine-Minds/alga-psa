import { beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => {
  const store = { users: [] as any[] };
  const createQuery = () => {
    const filters: Array<(row: any) => boolean> = [];
    const query: any = {
      where(cond: Record<string, unknown>) {
        filters.push((row) => Object.entries(cond).every(([k, v]) => row[k] === v));
        return query;
      },
      whereRaw(sql: string, bindings: any[]) {
        if (/lower\(email\)\s*=\s*\?/i.test(sql)) {
          const v = String(bindings[0]).toLowerCase();
          filters.push((row) => String(row.email ?? '').toLowerCase() === v);
        }
        return query;
      },
      async first() {
        const [row] = store.users.filter((r) => filters.every((p) => p(r)));
        return row ? { ...row } : undefined;
      },
    };
    return query;
  };
  const knexMock: any = () => createQuery();
  return { store, knexMock, createQuery };
});

vi.mock('@alga-psa/db', () => ({
  createTenantKnex: async () => ({ knex: hoisted.knexMock }),
  tenantDb: (_knex: any, tenant: string) => ({
    table: () => hoisted.createQuery().where({ tenant }),
  }),
}));

vi.mock('@alga-psa/telephony', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolveTenantPhoneCountryCode: async () => 'US',
}));

import {
  buildThreecxCanonicalCall,
  threecxProviderCallId,
  validateThreecxReportCallBody,
} from './reportCall';

const TENANT = 'tenant-1';

const baseBody = {
  callType: 'Inbound' as const,
  number: '+15551234567',
  agentEmail: 'agent@example.com',
  durationSeconds: 42,
  startTimeUtc: '2026-09-02T10:00:00Z',
  establishedTimeUtc: '2026-09-02T10:00:05Z',
  endTimeUtc: '2026-09-02T10:00:47Z',
};

describe('threecx report-call mapping', () => {
  beforeEach(() => {
    hoisted.store.users.length = 0;
  });

  it('T073: accepts a body with empty establishedTimeUtc and queueExtension', () => {
    const result = validateThreecxReportCallBody({ ...baseBody, establishedTimeUtc: '', queueExtension: '' });
    expect(result.ok).toBe(true);
  });

  it('T074: maps callType to direction', async () => {
    const inbound = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Inbound' });
    const outbound = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Outbound' });
    const missed = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Missed' });
    const notanswered = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Notanswered' });
    expect(inbound.direction).toBe('inbound');
    expect(outbound.direction).toBe('outbound');
    expect(missed.direction).toBe('missed');
    expect(notanswered.direction).toBe('missed');
  });

  it('T075: puts the number on the caller side for inbound and the callee side for outbound', async () => {
    const inbound = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Inbound' });
    expect(inbound.callerNumber).toEqual({ raw: '+15551234567', e164: '+15551234567' });
    expect(inbound.calleeNumber).toBeUndefined();

    const outbound = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Outbound' });
    expect(outbound.calleeNumber).toEqual({ raw: '+15551234567', e164: '+15551234567' });
    expect(outbound.callerNumber).toBeUndefined();
  });

  it('T076: the same body produces the same providerCallId', async () => {
    const a = await buildThreecxCanonicalCall({ tenantId: TENANT }, baseBody);
    const b = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody });
    expect(a.providerCallId).toBe(b.providerCallId);
    expect(a.providerCallId).toMatch(/^[a-f0-9]{64}$/);
  });

  it('T077: changing only the callType changes the providerCallId', () => {
    const inbound = threecxProviderCallId({ agentEmail: 'a@x.com', numberForHash: '+1', callType: 'Inbound', startTimeUtc: 's' });
    const missed = threecxProviderCallId({ agentEmail: 'a@x.com', numberForHash: '+1', callType: 'Missed', startTimeUtc: 's' });
    expect(inbound).not.toBe(missed);
  });

  it('T078: agentEmail differing only in case yields the same providerCallId', async () => {
    const lower = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, agentEmail: 'agent@example.com' });
    const upper = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, agentEmail: 'AGENT@EXAMPLE.COM' });
    expect(lower.providerCallId).toBe(upper.providerCallId);
  });

  it('T079: a matching tenant user resolves organizerUserId regardless of case', async () => {
    hoisted.store.users.push({ tenant: TENANT, user_id: 'user-9', email: 'agent@example.com' });
    const record = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, agentEmail: 'AGENT@example.com' });
    expect(record.organizerUserId).toBe('user-9');
  });

  it('T080: a user only in another tenant yields organizerUserId null', async () => {
    hoisted.store.users.push({ tenant: 'tenant-2', user_id: 'user-9', email: 'agent@example.com' });
    const record = await buildThreecxCanonicalCall({ tenantId: TENANT }, baseBody);
    expect(record.organizerUserId).toBeNull();
  });

  it('T081: a missed body yields duration 0, modality audio, and raw equal to the body', async () => {
    const record = await buildThreecxCanonicalCall({ tenantId: TENANT }, { ...baseBody, callType: 'Missed', durationSeconds: 99 });
    expect(record.durationSeconds).toBe(0);
    expect(record.modality).toBe('audio');
    expect(record.raw).toMatchObject({ callType: 'Missed', number: '+15551234567' });
  });
});
