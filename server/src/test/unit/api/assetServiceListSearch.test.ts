/**
 * REST asset list free-text search (mobile 2.0 FR11/FR12).
 *
 * `AssetService.list` is a complete override that never reaches
 * BaseService.applyFilters, so the `search` param has to be applied by the
 * override itself. Without it the Assets tab's search box returned the whole
 * unfiltered list. The same clause must reach the count query or the paginated
 * total disagrees with the rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = Record<string, any>;

const h = vi.hoisted(() => {
  const state: Record<string, Row[]> = { assets: [] };

  type Predicate = (row: Row) => boolean;

  class QB {
    // Top-level clauses are ANDed; a grouped where(cb) contributes one
    // predicate that ORs its own ILIKE legs, exactly as knex does.
    private predicates: Predicate[] = [];
    private orLegs: Predicate[] | null = null;

    constructor(private readonly table: string) {}

    private add(predicate: Predicate) {
      if (this.orLegs) this.orLegs.push(predicate);
      else this.predicates.push(predicate);
      return this;
    }

    where(arg: any, op?: any, value?: any) {
      if (typeof arg === 'function') {
        const outer = this.orLegs;
        const legs: Predicate[] = [];
        this.orLegs = legs;
        arg.call(this, this);
        this.orLegs = outer;
        return this.add((row) => legs.some((leg) => leg(row)));
      }
      if (typeof arg === 'string') {
        const col = arg.split('.').pop()!;
        if (op === 'ilike') {
          const needle = String(value).replace(/%/g, '').toLowerCase();
          return this.add((row) => String(row[col] ?? '').toLowerCase().includes(needle));
        }
        const expected = value === undefined ? op : value;
        return this.add((row) => row[col] === expected);
      }
      if (arg && typeof arg === 'object') {
        const entries = Object.entries(arg).map(([k, v]) => [k.split('.').pop()!, v] as const);
        return this.add((row) => entries.every(([k, v]) => row[k] === v));
      }
      return this;
    }
    whereILike(col: string, pattern: string) {
      return this.where(col, 'ilike', pattern);
    }
    orWhereILike(col: string, pattern: string) {
      return this.where(col, 'ilike', pattern);
    }
    whereNull(col: string) {
      const key = col.split('.').pop()!;
      return this.add((row) => row[key] === null || row[key] === undefined);
    }
    whereNotNull(col: string) {
      const key = col.split('.').pop()!;
      return this.add((row) => row[key] !== null && row[key] !== undefined);
    }
    join() {
      return this;
    }
    leftJoin() {
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
    private rows() {
      return (state[this.table] ?? []).filter((row) => this.predicates.every((p) => p(row)));
    }
  }

  const knex: any = (table: string) => new QB(table);
  knex.raw = (sql: string) => sql;
  knex.fn = { now: () => '2026-10-16T12:00:00.000Z' };
  return { state, knex };
});

vi.mock('@alga-psa/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@alga-psa/db')>();
  return {
    ...actual,
    tenantDb: (conn: any, tenant: string) => ({
      table: (table: string) => conn(table.split(' as ')[0]).where({ tenant }),
      tenantJoin: (query: any) => query,
    }),
  };
});

vi.mock('server/src/lib/eventBus/publishers', () => ({
  publishEvent: vi.fn(async () => undefined),
  publishWorkflowEvent: vi.fn(async () => undefined),
}));

import { AssetService } from '../../../lib/api/services/AssetService';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const context = { tenant: TENANT, userId: 'user-1', db: h.knex } as any;

let service: AssetService;

beforeEach(() => {
  h.state.assets = [
    {
      tenant: TENANT, asset_id: 'a-1', client_id: 'client-a', asset_tag: 'WS-0042',
      name: 'Reception PC', serial_number: 'SN-ALPHA', location: 'Front desk',
      manufacturer: 'Dell', model: 'OptiPlex', status: 'active', asset_type: 'workstation',
    },
    {
      tenant: TENANT, asset_id: 'a-2', client_id: 'client-a', asset_tag: 'PR-0001',
      name: 'Hallway printer', serial_number: 'SN-BETA', location: 'Hallway',
      manufacturer: 'HP', model: 'LaserJet', status: 'active', asset_type: 'printer',
    },
    {
      tenant: TENANT, asset_id: 'a-3', client_id: 'client-b', asset_tag: 'SRV-0001',
      name: 'File server', serial_number: 'SN-GAMMA', location: 'Rack 2',
      manufacturer: 'Lenovo', model: 'ThinkSystem', status: 'inactive', asset_type: 'server',
    },
    {
      tenant: OTHER_TENANT, asset_id: 'a-4', client_id: 'client-z', asset_tag: 'WS-0042',
      name: 'Reception PC', serial_number: 'SN-ALPHA', location: 'Front desk',
      manufacturer: 'Dell', model: 'OptiPlex', status: 'active', asset_type: 'workstation',
    },
  ];
  service = new AssetService();
});

describe('AssetService.list search (T137)', () => {
  it('narrows on the asset tag and reports the narrowed total', async () => {
    const result = await service.list({ page: 1, limit: 25 }, context, { search: 'WS-00' } as any);
    expect(result.data.map((row: Row) => row.asset_id)).toEqual(['a-1']);
    expect(result.total).toBe(1);
  });

  it('matches the name, serial number, location, manufacturer and model', async () => {
    const hits = async (search: string) => {
      const result = await service.list({ page: 1, limit: 25 }, context, { search } as any);
      return result.data.map((row: Row) => row.asset_id);
    };
    expect(await hits('printer')).toEqual(['a-2']);
    expect(await hits('sn-gamma')).toEqual(['a-3']);
    expect(await hits('hallway')).toEqual(['a-2']);
    expect(await hits('lenovo')).toEqual(['a-3']);
    expect(await hits('optiplex')).toEqual(['a-1']);
  });

  it('stays inside the tenant and composes with the other filters', async () => {
    const sameTag = await service.list({ page: 1, limit: 25 }, context, { search: 'WS-0042' } as any);
    expect(sameTag.data.map((row: Row) => row.asset_id)).toEqual(['a-1']);

    const scoped = await service.list({ page: 1, limit: 25 }, context, {
      search: 'SN-', client_id: 'client-a',
    } as any);
    expect(scoped.data.map((row: Row) => row.asset_id)).toEqual(['a-1', 'a-2']);
    expect(scoped.total).toBe(2);
  });

  it('returns nothing when the search matches nothing', async () => {
    const result = await service.list({ page: 1, limit: 25 }, context, { search: 'nosuchdevice' } as any);
    expect(result.data).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('leaves the list untouched when no search is given', async () => {
    const result = await service.list({ page: 1, limit: 25 }, context, {} as any);
    expect(result.data.map((row: Row) => row.asset_id)).toEqual(['a-1', 'a-2', 'a-3']);
    expect(result.total).toBe(3);
  });
});
