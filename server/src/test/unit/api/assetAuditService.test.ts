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
  const insertCalls: Record<string, number> = {};

  class QB {
    private wheres: Array<Record<string, any>> = [];
    private inWheres: Array<{ col: string; values: any[] }> = [];
    private nullWheres: string[] = [];
    private cmpWheres: Array<{ col: string; op: string; value: any }> = [];

    constructor(private readonly table: string) {}

    where(arg: any, op?: any, value?: any) {
      if (typeof arg === 'string') {
        const col = arg.split('.').pop()!;
        // `where(col, '>=', value)`: a comparison, not an equality. Folding it
        // into the equality list would make a range filter silently match
        // nothing (or everything), which is exactly what the tests check.
        if (typeof op === 'string' && ['>=', '<=', '>', '<'].includes(op)) {
          this.cmpWheres.push({ col, op, value });
          return this;
        }
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
      insertCalls[this.table] = (insertCalls[this.table] ?? 0) + 1;
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
          this.nullWheres.every((col) => row[col] === null || row[col] === undefined) &&
          this.cmpWheres.every(({ col, op, value }) => {
            const left = row[col];
            if (left === null || left === undefined) return false;
            if (op === '>=') return left >= value;
            if (op === '<=') return left <= value;
            if (op === '>') return left > value;
            return left < value;
          }),
      );
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.raw = (sql: string, bindings: unknown) => ({ sql, bindings });
  // Not a string on purpose: fn.now() is SQL, and Citus rejects it in the DO
  // UPDATE SET of an insert on a distributed table. A test asserting that a
  // stored timestamp is an ISO string therefore fails if it creeps back in.
  knex.fn = { now: () => ({ sql: 'CURRENT_TIMESTAMP' }) };
  knex.transaction = async (callback: (trx: any) => Promise<any>) => callback(knex);

  return {
    state,
    knex,
    insertCalls,
    setFailHistoryInsert: (value: boolean) => {
      failHistoryInsert = value;
    },
    resetInsertCalls: () => {
      Object.keys(insertCalls).forEach((table) => delete insertCalls[table]);
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

// The lifecycle lives in @alga-psa/assets (the v1 controller reaches it through
// a thin error-mapping adapter), so the behaviour is asserted where it lives.
import { AssetAuditService } from '@alga-psa/assets/lib/audits/service';

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
  h.resetInsertCalls();
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

  it('T116 keeps an unexpected asset unexpected when it is scanned again', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'scan' }, context);

    await service.markItem(audit.audit_id, { asset_id: 'a-5', result: 'present', method: 'manual' }, context);

    const rows = items(audit.audit_id).filter((item) => item.asset_id === 'a-5');
    expect(rows).toHaveLength(1);
    expect(rows[0].result).toBe('unexpected');
  });

  it('T117 binds marked_at as a value, since Citus forbids SQL functions in a merge', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    // Every expected asset already has a snapshot row, so a mark always takes
    // the ON CONFLICT path.
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);

    const row = items(audit.audit_id).find((item) => item.asset_id === 'a-1')!;
    expect(typeof row.marked_at).toBe('string');
    expect(Number.isNaN(Date.parse(row.marked_at))).toBe(false);
  });

  it('T126 marks an asset that joined the scope after the snapshot as present', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    // The device a technician registers mid-walk: same client, same location.
    h.state.assets.push(asset('a-new'));

    const marked = await service.markItem(
      audit.audit_id,
      { asset_id: 'a-new', result: 'present', method: 'register' },
      context,
    );

    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-new')?.result).toBe('present');
    // Expected widens with it, so expected stays present + missing on completion.
    expect(marked.expected_count).toBe(3);
  });

  it('T127 keeps a device whose status is out of scope unexpected', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    // pg hands jsonb back parsed; the fake stores what the insert was given.
    h.state.asset_audits[0].statuses = ['active'];

    await service.markItem(audit.audit_id, { asset_id: 'a-3', result: 'present', method: 'scan' }, context);

    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-3')?.result).toBe('unexpected');
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

  it('writes the audit trail in one insert instead of one per asset', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'scan' }, context);
    h.resetInsertCalls();

    await service.complete(audit.audit_id, context);

    // Two assets touched (a-1 present, a-2 missing), one round trip.
    expect(h.state.asset_history).toHaveLength(2);
    expect(h.insertCalls.asset_history).toBe(1);
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

/**
 * The web list filters on more than the client: mobile sends client only, the
 * desktop list sends location (including "no location"), status and a
 * started_at range. Both the rows and the count must see the same predicates,
 * or the pager disagrees with the page it is paging over.
 */
describe('AssetAuditService.list filters', () => {
  const otherLocation = 'loc-2';

  async function seedAudits() {
    const here = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    const nowhere = await service.start({ client_id: CLIENT, location_id: null, statuses: ['active'] }, context);
    const elsewhere = await service.start(
      { client_id: 'client-9', location_id: otherLocation, statuses: [] },
      context,
    );
    await service.complete(here.audit_id, context);
    // Dated by hand: the fake inserts rows without the column default.
    h.state.asset_audits.find((row) => row.audit_id === here.audit_id)!.started_at = '2026-03-01T10:00:00.000Z';
    h.state.asset_audits.find((row) => row.audit_id === nowhere.audit_id)!.started_at = '2026-03-05T10:00:00.000Z';
    h.state.asset_audits.find((row) => row.audit_id === elsewhere.audit_id)!.started_at =
      '2026-04-10T10:00:00.000Z';
    return { here, nowhere, elsewhere };
  }

  it('narrows by client, and the count agrees with the rows', async () => {
    const { here, nowhere } = await seedAudits();

    const listed = await service.list({ client_id: CLIENT }, context);

    expect(listed.total).toBe(2);
    expect(listed.data.map((row) => row.audit_id).sort()).toEqual([here.audit_id, nowhere.audit_id].sort());
  });

  it('narrows by location, and "no location" is its own answer', async () => {
    const { here, nowhere } = await seedAudits();

    const atLocation = await service.list({ location_id: LOCATION }, context);
    const withoutLocation = await service.list({ no_location: true }, context);

    expect(atLocation.data.map((row) => row.audit_id)).toEqual([here.audit_id]);
    expect(atLocation.total).toBe(1);
    expect(withoutLocation.data.map((row) => row.audit_id)).toEqual([nowhere.audit_id]);
    expect(withoutLocation.total).toBe(1);
  });

  it('"no location" wins over a location_id sent alongside it', async () => {
    const { nowhere } = await seedAudits();

    const listed = await service.list({ no_location: true, location_id: LOCATION }, context);

    expect(listed.data.map((row) => row.audit_id)).toEqual([nowhere.audit_id]);
  });

  it('narrows by status', async () => {
    const { here } = await seedAudits();

    const completed = await service.list({ status: 'completed' }, context);
    const open = await service.list({ status: 'in_progress' }, context);

    expect(completed.data.map((row) => row.audit_id)).toEqual([here.audit_id]);
    expect(completed.total).toBe(1);
    expect(open.total).toBe(2);
  });

  it('narrows by a started_at range, inclusive of both bounds', async () => {
    const { here, nowhere } = await seedAudits();

    const inMarch = await service.list(
      { started_from: '2026-03-01T00:00:00.000Z', started_to: '2026-03-31T23:59:59.999Z' },
      context,
    );
    const fromTheFifth = await service.list({ started_from: '2026-03-05T10:00:00.000Z' }, context);

    expect(inMarch.total).toBe(2);
    expect(inMarch.data.map((row) => row.audit_id).sort()).toEqual([here.audit_id, nowhere.audit_id].sort());
    expect(fromTheFifth.data.map((row) => row.audit_id)).toContain(nowhere.audit_id);
    expect(fromTheFifth.data.map((row) => row.audit_id)).not.toContain(here.audit_id);
  });

  it('combines filters instead of letting the last one win', async () => {
    const { here } = await seedAudits();

    const listed = await service.list(
      { client_id: CLIENT, location_id: LOCATION, status: 'completed', started_from: '2026-01-01T00:00:00.000Z' },
      context,
    );

    expect(listed.data.map((row) => row.audit_id)).toEqual([here.audit_id]);
    expect(listed.total).toBe(1);
  });
});

/**
 * The web items table shows the asset's type, serial, tag and who marked it —
 * the reads have to carry those, or the table renders a column of dashes.
 */
describe('AssetAuditService read enrichment', () => {
  it('selects the asset type and the marking user alongside the item identity', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);
    await service.markItem(audit.audit_id, { asset_id: 'a-1', result: 'present', method: 'manual' }, context);

    const fetched = await service.get(audit.audit_id, context);
    const item = fetched.items.find((row) => row.asset_id === 'a-1')!;

    // The fake returns whole rows (joins are no-ops), so the assertion is that
    // the selected shape is wired, including the marking user id.
    expect(item.marked_by).toBe('user-1');
    expect(item.method).toBe('manual');
  });

  it('defaults a mark with no method to manual, the way the web marks', async () => {
    const audit = await service.start({ client_id: CLIENT, location_id: LOCATION, statuses: ['active'] }, context);

    await service.markItem(audit.audit_id, { asset_id: 'a-1' }, context);

    expect(items(audit.audit_id).find((item) => item.asset_id === 'a-1')?.method).toBe('manual');
  });
});

/**
 * The start dialog's live count is taken off the same predicate the snapshot
 * uses, so the number the technician sees is the number they get.
 */
describe('AssetAuditService.previewScope', () => {
  it('counts the assets the snapshot would hold', async () => {
    const expected = await service.previewScope(
      { client_id: CLIENT, location_id: LOCATION, statuses: ['active'] },
      context,
    );

    expect(expected).toBe(2);
  });

  it('counts the no-location scope separately', async () => {
    const expected = await service.previewScope({ client_id: CLIENT, location_id: null }, context);

    expect(expected).toBe(1);
  });

  it('agrees with what start actually snapshots', async () => {
    const scope = { client_id: CLIENT, location_id: LOCATION, statuses: ['active'] };

    const previewed = await service.previewScope(scope, context);
    const audit = await service.start(scope, context);

    expect(audit.expected_count).toBe(previewed);
  });
});
