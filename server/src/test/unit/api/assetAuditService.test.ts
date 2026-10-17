/**
 * Site audit service (mobile 2.0 FR16): the expected set is snapshotted at
 * start, marks are idempotent, an out-of-scope asset is always recorded as
 * unexpected, and completing turns the remainder into `missing` while writing
 * one asset_history row per touched asset.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state: Record<string, Row[]> = {
    assets: [],
    asset_audits: [],
    asset_audit_items: [],
    asset_history: [],
  };
  let failHistoryInsert = false;
  let nextId = 0;

  class QB {
    private wheres: Array<Record<string, any>> = [];
    private inWheres: Array<{ col: string; values: any[] }> = [];
    private nullWheres: string[] = [];

    constructor(private readonly table: string) {}

    where(arg: any, op?: any, value?: any) {
      if (typeof arg === 'string') {
        const col = arg.split('.').pop()!;
        this.wheres.push({ [col]: value === undefined ? op : value });
      } else if (arg && typeof arg === 'object') {
        this.wheres.push(
          Object.fromEntries(Object.entries(arg).map(([key, val]) => [key.split('.').pop()!, val])),
        );
      }
      return this;
    }
    whereIn(col: string, values: any[]) {
      this.inWheres.push({ col: col.split('.').pop()!, values });
      return this;
    }
    whereNull(col: string) {
      this.nullWheres.push(col.split('.').pop()!);
      return this;
    }
    leftJoin() {
      return this;
    }
    join() {
      return this;
    }
    select(..._cols: any[]) {
      return this;
    }
    orderBy() {
      return this;
    }
    limit() {
      return this;
    }
    offset() {
      return this;
    }
    count(expression: string) {
      const alias = expression.includes(' as ') ? expression.split(' as ')[1] : 'count';
      const rows = this.rows();
      const result: any = Promise.resolve([{ [alias]: String(rows.length) }]);
      result.first = () => Promise.resolve({ [alias]: String(rows.length) });
      return result;
    }
    then(resolve: (value: any) => void, reject?: (reason: unknown) => void) {
      return Promise.resolve(this.rows().map((row) => ({ ...row }))).then(resolve, reject);
    }
    async first(..._cols: string[]) {
      const row = this.rows()[0];
      return row ? { ...row } : undefined;
    }
    update(patch: Row) {
      const rows = this.rows();
      rows.forEach((row) => Object.assign(row, patch));
      const result: any = Promise.resolve(rows.length);
      result.returning = () => Promise.resolve(rows.map((row) => ({ ...row })));
      return result;
    }
    delete() {
      const doomed = new Set(this.rows());
      state[this.table] = (state[this.table] ?? []).filter((row) => !doomed.has(row));
      return Promise.resolve(doomed.size);
    }
    insert(row: Row | Row[]) {
      if (this.table === 'asset_history' && failHistoryInsert) {
        return Promise.reject(new Error('history insert exploded')) as any;
      }
      const incoming = Array.isArray(row) ? row : [row];
      const stored = incoming.map((entry) => {
        nextId += 1;
        const copy: Row = { ...entry };
        if (this.table === 'asset_audits' && !copy.audit_id) copy.audit_id = `audit-${nextId}`;
        (state[this.table] ??= []).push(copy);
        return copy;
      });
      const result: any = Promise.resolve(stored);
      result.returning = () => Promise.resolve(stored.map((entry) => ({ ...entry })));
      // onConflict().merge() upserts on (tenant, audit_id, asset_id).
      result.onConflict = () => ({
        merge: (patch: Row) => {
          const [entry] = stored;
          const existing = (state[this.table] ?? []).filter(
            (candidate) =>
              candidate !== entry &&
              candidate.tenant === entry.tenant &&
              candidate.audit_id === entry.audit_id &&
              candidate.asset_id === entry.asset_id,
          );
          if (existing.length > 0) {
            state[this.table] = (state[this.table] ?? []).filter((candidate) => candidate !== entry);
            existing.forEach((candidate) => Object.assign(candidate, patch));
          }
          return Promise.resolve(1);
        },
        ignore: () => Promise.resolve(0),
      });
      return result;
    }
    private rows() {
      return (state[this.table] ?? []).filter(
        (row) =>
          this.wheres.every((w) => Object.entries(w).every(([k, v]) => row[k] === v)) &&
          this.inWheres.every(({ col, values }) => values.includes(row[col])) &&
          this.nullWheres.every((col) => row[col] === null || row[col] === undefined),
      );
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.raw = (sql: string, bindings: unknown) => ({ sql, bindings });
  knex.fn = { now: () => '2026-10-16T12:00:00.000Z' };
  knex.transaction = async (callback: (trx: any) => Promise<any>) => callback(knex);

  return {
    state,
    knex,
    setFailHistoryInsert: (value: boolean) => {
      failHistoryInsert = value;
    },
  };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: (conn: any, tenant: string) => ({
      table: (table: string) => conn(table.split(' as ')[0]).where({ tenant }),
      tenantJoin: () => undefined,
      unscoped: (table: string) => conn(table.split(' as ')[0]),
    }),
    // The fake knex has no real transaction; a thrown error must still leave
    // nothing behind, which the test asserts by snapshotting state.
    withTransaction: async (conn: any, callback: (trx: any) => Promise<any>) => callback(conn),
  };
});

import { AssetAuditService } from '../../../lib/api/services/AssetAuditService';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const CLIENT = 'client-1';
const LOCATION = 'loc-1';

const context = { tenant: TENANT, userId: 'user-1', db: h.knex } as any;

function asset(asset_id: string, overrides: Row = {}): Row {
  return {
    tenant: TENANT,
    asset_id,
    client_id: CLIENT,
    location_id: LOCATION,
    status: 'active',
    name: asset_id,
    asset_tag: asset_id.toUpperCase(),
    ...overrides,
  };
}

let service: AssetAuditService;

beforeEach(() => {
  h.setFailHistoryInsert(false);
  h.state.assets = [
    asset('a-1'),
    asset('a-2'),
    asset('a-3', { status: 'retired' }),
    asset('a-4', { location_id: null }),
    asset('a-5', { client_id: 'client-9' }),
    asset('a-6', { tenant: OTHER_TENANT }),
  ];
  h.state.asset_audits = [];
  h.state.asset_audit_items = [];
  h.state.asset_history = [];
  service = new AssetAuditService();
});

function items(auditId: string) {
  return h.state.asset_audit_items.filter((item) => item.audit_id === auditId);
}

describe('AssetAuditService.start', () => {
  it('T046 snapshots only the client, location and status slugs in scope', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    expect(audit.expected_count).toBe(2);
    expect(items(audit.audit_id).map((item) => item.asset_id).sort()).toEqual(['a-1', 'a-2']);
    expect(items(audit.audit_id).every((item) => item.result === 'expected')).toBe(true);
  });

  it('T046 a null location audits the assets that have no location', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: null, statuses: ['active'] }, context);

    expect(items(audit.audit_id).map((item) => item.asset_id)).toEqual(['a-4']);
  });

  it('T047 returns expected_count 0 and no items when nothing matches', async () => {
    const audit = await service.start({ client_id: 'client-none', statuses: ['active'] }, context);

    expect(audit.expected_count).toBe(0);
    expect(audit.items).toEqual([]);
  });
});

describe('AssetAuditService.markItem', () => {
  it('T048 marking the same asset twice leaves one row and keeps the first marked_at', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    const firstMarkedAt = items(audit.audit_id).find((item) => item.asset_id === 'a-1')!.marked_at;
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'manual' }, context);

    const rows = items(audit.audit_id).filter((item) => item.asset_id === 'a-1');
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe('present');
    expect(rows[0].marked_at).toBe(firstMarkedAt);
    expect(rows[0].method).toBe('scan');
  });

  it('T049 stores an asset outside the snapshot as unexpected even when present was asked for', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'scan' }, context);

    const row = items(audit.audit_id).find((item) => item.asset_id === 'a-5');
    expect(row?.result).toBe('unexpected');
  });

  it('T050 rejects an asset of another tenant with 404', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    await expect(
      service.markItem(audit.audit_id, { asset_id: 'a-6', result: 'present', method: 'scan' }, context),
    ).rejects.toThrow('Asset not found');
  });

  it('T056 refuses to mark on an audit that is no longer in progress', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.complete(audit.audit_id, context);

    await expect(
      service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context),
    ).rejects.toThrow('Audit is completed');
  });
});

describe('AssetAuditService.unmarkItem', () => {
  it('returns an expected asset to the remaining list and drops an unexpected one', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'scan' }, context);

    await service.unmarkItem(audit.audit_id, 'a-1', context);
    await service.unmarkItem(audit.audit_id, 'a-5', context);

    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-1')).toMatchObject({
      result: 'expected',
      marked_at: null,
    });
    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-5')).toBeUndefined();
  });
});

describe('AssetAuditService.complete', () => {
  it('T051 fills missing from expected minus present and writes the counts', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'scan' }, context);

    const completed = await service.complete(audit.audit_id, context);

    expect(completed.status).toBe('completed');
    expect(completed.present_count).toBe(1);
    expect(completed.missing_count).toBe(1);
    expect(completed.unexpected_count).toBe(1);
    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-2')?.result).toBe('missing');
  });

  it('T052 writes an asset_history row per present and missing asset and sets last_audited_at', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'scan' }, context);

    await service.complete(audit.audit_id, context);

    expect(h.state.asset_history).toHaveLength(2);
    expect(h.state.asset_history.every((row) => row.change_type === 'audit')).toBe(true);
    const changes = JSON.parse(h.state.asset_history[0].changes);
    expect(changes).toMatchObject({ audit_id: audit.audit_id, result: 'present', location_id: LOCATION });
    // The unexpected asset is recorded in the audit but not in asset history.
    expect(h.state.asset_history.map((row) => row.asset_id)).not.toContain('a-5');
    expect(h.state.assets.find((row) => row.asset_id === 'a-1')?.last_audit_result).toBe('present');
    expect(h.state.assets.find((row) => row.asset_id === 'a-2')?.last_audit_result).toBe('missing');
    expect(h.state.assets.find((row) => row.asset_id === 'a-1')?.last_audited_at).toBeTruthy();
  });

  it('T053 leaves the audit in progress when a history insert fails', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    h.setFailHistoryInsert(true);

    await expect(service.complete(audit.audit_id, context)).rejects.toThrow('history insert exploded');

    expect(h.state.asset_audits[0].status).toBe('in_progress');
    expect(h.state.asset_history).toHaveLength(0);
    expect(h.state.assets.find((row) => row.asset_id === 'a-1')?.last_audited_at).toBeUndefined();
  });
});

describe('AssetAuditService.cancel, get and list', () => {
  it('T054 cancelling a completed audit is a conflict', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.complete(audit.audit_id, context);

    await expect(service.cancel(audit.audit_id, context)).rejects.toThrow('Audit is completed');
  });

  it('cancels an open audit without touching asset history', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    const cancelled = await service.cancel(audit.audit_id, context);

    expect(cancelled.status).toBe('cancelled');
    expect(h.state.asset_history).toHaveLength(0);
  });

  it('T057 lists only this tenant audits and reads one back by id', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    h.state.asset_audits.push({
      tenant: OTHER_TENANT,
      audit_id: 'other-audit',
      client_id: 'client-x',
      status: 'in_progress',
    });

    const listed = await service.list({}, context);
    expect(listed.total).toBe(1);
    expect(listed.data.map((row) => row.audit_id)).toEqual([audit.audit_id]);

    const fetched = await service.get(audit.audit_id, context);
    expect(fetched.audit_id).toBe(audit.audit_id);
    expect(fetched.items).toHaveLength(2);
  });

  it('reports a missing audit as not found', async () => {
    await expect(service.get('nope', context)).rejects.toThrow('Audit not found');
  });
});
