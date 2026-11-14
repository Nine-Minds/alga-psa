import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Behaviour tests for the contact ↔ location link against an in-memory stand-in for the tenant
 * database. What matters here is state after the write, not SQL: the set is replaced rather than
 * appended to, exactly one link is primary, a cross-client location is refused before anything is
 * written, and nothing a query asks for ever escapes its tenant.
 *
 * The partial unique index (tenant, contact_name_id) WHERE is_primary is modelled too, so the
 * write order inside replaceContactLocations is actually under test — a naive implementation that
 * flags the new primary before clearing the old one fails here the way PostgreSQL would.
 */

type Row = Record<string, any>;

const state: Record<string, Row[]> = {};

function table(name: string): Row[] {
  if (!state[name]) state[name] = [];
  return state[name];
}

function valueOf(row: Row, key: string): any {
  if (key in row) return row[key];
  const bare = key.includes('.') ? key.slice(key.indexOf('.') + 1) : key;
  return row[bare];
}

/** The invariant PostgreSQL holds for us; broken write order shows up as a throw, not a wrong read. */
function assertSinglePrimary(name: string) {
  if (name !== 'contact_locations') return;
  const seen = new Set<string>();
  for (const row of table(name)) {
    if (!row.is_primary) continue;
    const key = `${row.tenant}:${row.contact_name_id}`;
    if (seen.has(key)) {
      throw Object.assign(new Error('duplicate key value violates unique constraint "idx_contact_locations_primary"'), {
        code: '23505',
        constraint: 'idx_contact_locations_primary',
      });
    }
    seen.add(key);
  }
}

class FakeBuilder {
  private predicates: Array<(row: Row) => boolean> = [];
  private joins: Array<{ table: string; left: string; right: string }> = [];
  private orders: Array<{ column: string; direction: string }> = [];
  private plucked: string | null = null;
  private grouped: string | null = null;
  private counted: string | null = null;
  private pendingInsert: Row[] | null = null;
  readonly queries: string[];

  constructor(private readonly tableExpression: string, private readonly tenant: string, log: string[]) {
    this.queries = log;
    log.push(tableExpression);
    const bare = tableExpression.split(' as ')[0];
    // Every scoped query carries the tenant on the root table, which is what makes the isolation
    // assertions below meaningful rather than accidental.
    void bare;
    this.predicates.push((row) => row.tenant === undefined || row.tenant === this.tenant);
  }

  private get tableName() {
    return this.tableExpression.split(' as ')[0];
  }

  addJoin(join: { table: string; left: string; right: string }) {
    this.joins.push(join);
    return this;
  }

  where(criteria: Row | string, value?: any) {
    if (typeof criteria === 'string') {
      this.predicates.push((row) => valueOf(row, criteria) === value);
    } else {
      this.predicates.push((row) => Object.entries(criteria).every(([key, expected]) => valueOf(row, key) === expected));
    }
    return this;
  }

  whereIn(column: string, values: any[]) {
    this.predicates.push((row) => values.includes(valueOf(row, column)));
    return this;
  }

  whereNotIn(column: string, values: any[]) {
    this.predicates.push((row) => !values.includes(valueOf(row, column)));
    return this;
  }

  orderBy(column: any, direction = 'asc') {
    const entries = Array.isArray(column) ? column : [{ column, order: direction }];
    for (const entry of entries) {
      this.orders.push({ column: entry.column, direction: entry.order ?? 'asc' });
    }
    return this;
  }

  groupBy(column: string) {
    this.grouped = column;
    return this;
  }

  count(expression: string) {
    this.counted = expression;
    return this;
  }

  select(..._columns: any[]) {
    return this;
  }

  pluck(column: string) {
    this.plucked = column;
    return this;
  }

  async first(_columns?: any) {
    const rows = await this.run();
    return rows[0];
  }

  then<T1 = any, T2 = never>(
    onFulfilled?: ((value: any) => T1 | PromiseLike<T1>) | null,
    onRejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): Promise<T1 | T2> {
    return this.run().then(onFulfilled, onRejected);
  }

  insert(payload: Row | Row[]) {
    this.pendingInsert = Array.isArray(payload) ? payload : [payload];
    return this;
  }

  async update(patch: Row): Promise<number> {
    const matched = this.resolve();
    for (const row of matched) Object.assign(row, patch);
    assertSinglePrimary(this.tableName);
    return matched.length;
  }

  async delete(): Promise<number> {
    const matched = new Set(this.resolve());
    const rows = table(this.tableName);
    const remaining = rows.filter((row) => !matched.has(row));
    const removed = rows.length - remaining.length;
    rows.length = 0;
    rows.push(...remaining);
    return removed;
  }

  private async run(): Promise<any> {
    if (this.pendingInsert) {
      const rows = this.pendingInsert;
      this.pendingInsert = null;
      for (const row of rows) table(this.tableName).push({ created_at: '2026-10-28T00:00:00Z', ...row });
      assertSinglePrimary(this.tableName);
      return rows;
    }

    const matched = this.resolve();

    if (this.counted && this.grouped) {
      const groups = new Map<string, number>();
      for (const row of matched) {
        const key = String(valueOf(row, this.grouped));
        groups.set(key, (groups.get(key) ?? 0) + 1);
      }
      return [...groups.entries()].map(([key, count]) => ({ [this.grouped!]: key, count: String(count) }));
    }
    if (this.counted) return [{ count: String(matched.length) }];
    if (this.plucked) return matched.map((row) => valueOf(row, this.plucked!));
    return matched;
  }

  private resolve(): Row[] {
    let candidates: Row[] = table(this.tableName);

    if (this.joins.length > 0) {
      candidates = candidates.map((row) => {
        const merged: Row = { ...row };
        for (const join of this.joins) {
          const joinedAlias = join.left.split('.')[0];
          const joinedTable = this.joins.find((j) => j.left.startsWith(`${joinedAlias}.`))?.table.split(' as ')[0]
            ?? joinedAlias;
          const leftColumn = join.left.split('.')[1];
          const rightColumn = join.right.split('.')[1];
          const match = table(joinedTable).find(
            (joinedRow) => joinedRow.tenant === row.tenant && joinedRow[leftColumn] === row[rightColumn],
          );
          if (!match) return null as unknown as Row;
          for (const [column, value] of Object.entries(match)) {
            if (!(column in merged)) merged[column] = value;
          }
        }
        return merged;
      }).filter(Boolean);
    }

    let matched = candidates.filter((row) => this.predicates.every((predicate) => predicate(row)));
    for (const order of [...this.orders].reverse()) {
      matched = [...matched].sort((a, b) => {
        const left = valueOf(a, order.column) ?? '';
        const right = valueOf(b, order.column) ?? '';
        const comparison = left === right ? 0 : left > right ? 1 : -1;
        return order.direction === 'desc' ? -comparison : comparison;
      });
    }
    return matched;
  }
}

const queryLog: string[] = [];

vi.mock('@alga-psa/db', () => ({
  tenantDb: (_conn: unknown, tenant: string) => ({
    table: (expression: string) => new FakeBuilder(expression, tenant, queryLog),
    tenantJoin: (builder: any, joinTable: string, left: string, right: string) =>
      builder.addJoin({ table: joinTable, left, right }),
  }),
}));

import {
  ContactLocationClientMismatch,
  getContactCountsByLocation,
  getContactLocationCount,
  getContactLocations,
  getContactsAtLocation,
  replaceContactLocations,
} from './contactLocation';
import { attachContactLocations } from '../lib/contactLocations';

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const trx = {} as never;

function seed() {
  for (const key of Object.keys(state)) delete state[key];
  queryLog.length = 0;

  table('contacts').push(
    { tenant: TENANT, contact_name_id: 'ada', full_name: 'Ada Lovelace', client_id: 'acme', work_arrangement: null },
    { tenant: TENANT, contact_name_id: 'bob', full_name: 'Bob Stone', client_id: 'acme', work_arrangement: 'remote' },
    { tenant: TENANT, contact_name_id: 'cal', full_name: 'Cal Reed', client_id: 'globex', work_arrangement: null },
    { tenant: TENANT, contact_name_id: 'dot', full_name: 'Dot Lane', client_id: null, work_arrangement: null },
    { tenant: OTHER_TENANT, contact_name_id: 'eve', full_name: 'Eve Other', client_id: 'other', work_arrangement: null },
  );

  table('client_locations').push(
    { tenant: TENANT, location_id: 'warehouse', client_id: 'acme', location_name: 'Warehouse', city: 'Leeds', address_line1: '1 Dock Rd', is_active: true, is_default: false },
    { tenant: TENANT, location_id: 'head-office', client_id: 'acme', location_name: 'Head office', city: 'London', address_line1: '2 King St', is_active: true, is_default: true },
    { tenant: TENANT, location_id: 'old-depot', client_id: 'acme', location_name: 'Old depot', city: 'Hull', address_line1: '3 Quay', is_active: false, is_default: false },
    { tenant: TENANT, location_id: 'globex-hq', client_id: 'globex', location_name: 'Globex HQ', city: 'Oslo', is_active: true, is_default: true },
    { tenant: OTHER_TENANT, location_id: 'foreign', client_id: 'other', location_name: 'Foreign', is_active: true, is_default: true },
  );

  table('contact_locations');
}

beforeEach(seed);

const linksOf = (contactId: string) =>
  table('contact_locations')
    .filter((row) => row.contact_name_id === contactId)
    .map((row) => ({ location_id: row.location_id, is_primary: row.is_primary }));

describe('replaceContactLocations', () => {
  it('writes two links with the flagged one primary', async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office' },
    ]);

    expect(linksOf('ada')).toEqual([
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office', is_primary: false },
    ]);
  });

  it('makes a lone link primary even when the caller did not say so', async () => {
    const result = await replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'warehouse' }]);

    expect(linksOf('ada')).toEqual([{ location_id: 'warehouse', is_primary: true }]);
    expect(result).toEqual([expect.objectContaining({ location_id: 'warehouse', is_primary: true, city: 'Leeds' })]);
  });

  it('replaces the set rather than adding to it, and [] removes every link', async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office' },
    ]);

    await replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'head-office', is_primary: true }]);
    expect(linksOf('ada')).toEqual([{ location_id: 'head-office', is_primary: true }]);

    await replaceContactLocations(trx, TENANT, 'ada', []);
    expect(linksOf('ada')).toEqual([]);
  });

  it('moves the primary flag between links without ever holding two', async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office' },
    ]);

    // Would raise 23505 on the partial unique index if the new primary were flagged first.
    await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse' },
      { location_id: 'head-office', is_primary: true },
    ]);

    expect(linksOf('ada')).toEqual([
      { location_id: 'warehouse', is_primary: false },
      { location_id: 'head-office', is_primary: true },
    ]);
  });

  it('refuses a location of another client and writes nothing', async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'warehouse', is_primary: true }]);

    await expect(replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'globex-hq' },
    ])).rejects.toBeInstanceOf(ContactLocationClientMismatch);

    expect(linksOf('ada')).toEqual([{ location_id: 'warehouse', is_primary: true }]);
  });

  it('refuses an unknown location id and a contact with no client', async () => {
    await expect(replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'nope' }]))
      .rejects.toMatchObject({ code: 'contact_location_client_mismatch' });
    await expect(replaceContactLocations(trx, TENANT, 'dot', [{ location_id: 'warehouse' }]))
      .rejects.toBeInstanceOf(ContactLocationClientMismatch);
  });

  it('refuses two primaries', async () => {
    await expect(replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office', is_primary: true },
    ])).rejects.toThrow(/only one primary location/);

    expect(linksOf('ada')).toEqual([]);
  });

  it('keeps a linked inactive location and reports it as inactive', async () => {
    const result = await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'head-office', is_primary: true },
      { location_id: 'old-depot' },
    ]);

    expect(result.find((location) => location.location_id === 'old-depot')).toMatchObject({ is_active: false });
  });

  it('refuses a contact that does not exist', async () => {
    await expect(replaceContactLocations(trx, TENANT, 'ghost', [])).rejects.toThrow(/NOT_FOUND/);
  });
});

describe('tenant isolation', () => {
  it('hides links written under one tenant from reads under another', async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'warehouse', is_primary: true }]);

    expect(await getContactLocations(trx, TENANT, 'ada')).toHaveLength(1);
    expect(await getContactLocations(trx, OTHER_TENANT, 'ada')).toEqual([]);
    expect(await getContactLocationCount(trx, OTHER_TENANT, 'ada')).toBe(0);
  });

  it('treats another tenant\'s location id as not found', async () => {
    await expect(replaceContactLocations(trx, TENANT, 'ada', [{ location_id: 'foreign' }]))
      .rejects.toBeInstanceOf(ContactLocationClientMismatch);
  });
});

describe('reads', () => {
  beforeEach(async () => {
    await replaceContactLocations(trx, TENANT, 'ada', [
      { location_id: 'warehouse', is_primary: true },
      { location_id: 'head-office' },
    ]);
    await replaceContactLocations(trx, TENANT, 'bob', [{ location_id: 'warehouse', is_primary: true }]);
  });

  it('counts a contact\'s links, and 0 for a contact with none', async () => {
    expect(await getContactLocationCount(trx, TENANT, 'ada')).toBe(2);
    expect(await getContactLocationCount(trx, TENANT, 'cal')).toBe(0);
  });

  it('counts the contacts at each location', async () => {
    const counts = await getContactCountsByLocation(trx, TENANT, ['warehouse', 'head-office', 'old-depot']);
    expect(counts.get('warehouse')).toBe(2);
    expect(counts.get('head-office')).toBe(1);
    expect(counts.has('old-depot')).toBe(false);
  });

  it('lists the contacts at a location by name', async () => {
    expect(await getContactsAtLocation(trx, TENANT, 'warehouse')).toEqual([
      expect.objectContaining({ contact_name_id: 'ada', full_name: 'Ada Lovelace', is_primary: true }),
      expect.objectContaining({ contact_name_id: 'bob', full_name: 'Bob Stone', is_primary: true }),
    ]);
  });

  it('attaches locations and primaryLocation to a page of rows in one batched read', async () => {
    queryLog.length = 0;
    const rows = await attachContactLocations(
      trx,
      TENANT,
      [{ contact_name_id: 'ada' }, { contact_name_id: 'bob' }, { contact_name_id: 'cal' }],
      (row) => row.contact_name_id,
    );

    expect(queryLog).toEqual(['contact_locations as cl']);
    expect(rows[0].locations.map((location) => location.location_id)).toEqual(['warehouse', 'head-office']);
    expect(rows[0].primaryLocation).toEqual({ location_id: 'warehouse', location_name: 'Warehouse' });
    expect(rows[2].locations).toEqual([]);
    expect(rows[2].primaryLocation).toBeNull();
  });

  it('returns the address fields and is_primary for a single contact read', async () => {
    expect(await getContactLocations(trx, TENANT, 'ada')).toEqual([
      expect.objectContaining({
        location_id: 'warehouse',
        location_name: 'Warehouse',
        is_primary: true,
        is_active: true,
        address_line1: '1 Dock Rd',
        city: 'Leeds',
      }),
      expect.objectContaining({ location_id: 'head-office', is_primary: false }),
    ]);
  });
});
