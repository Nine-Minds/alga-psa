import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

type ColumnRecord = {
  name: string;
  type: string;
  defaultTo?: unknown;
  notNullable?: boolean;
  nullable?: boolean;
};

class FakeColumnBuilder {
  constructor(private readonly column: ColumnRecord) {}

  notNullable() {
    this.column.notNullable = true;
    return this;
  }

  nullable() {
    this.column.nullable = true;
    return this;
  }

  defaultTo(value: unknown) {
    this.column.defaultTo = value;
    return this;
  }
}

class FakeTableBuilder {
  columns: ColumnRecord[] = [];
  indexes: Array<{ columns: string[]; name: string }> = [];
  uniques: Array<{ columns: string[]; name: string }> = [];

  private addColumn(type: string, name: string) {
    const existing = this.columns.find((column) => column.name === name);
    if (existing) {
      return new FakeColumnBuilder(existing);
    }

    const column: ColumnRecord = { name, type };
    this.columns.push(column);
    return new FakeColumnBuilder(column);
  }

  uuid(name: string) {
    return this.addColumn('uuid', name);
  }

  timestamp(name: string) {
    return this.addColumn('timestamp', name);
  }

  unique(columns: string[], name: string) {
    this.uniques.push({ columns, name });
  }

  index(columns: string[], name: string) {
    this.indexes.push({ columns, name });
  }

  dropUnique() {}

  dropIndex() {}

  dropColumn() {}
}

function createFakeKnex() {
  const tables = new Map<string, FakeTableBuilder>();
  tables.set('recurring_service_periods', new FakeTableBuilder());
  const rawCalls: string[] = [];

  const knex = {
    schema: {
      hasTable: vi.fn(async () => true),
      alterTable: vi.fn(async (tableName: string, callback: (table: FakeTableBuilder) => void) => {
        const table = tables.get(tableName);
        if (!table) {
          throw new Error(`Missing table ${tableName}`);
        }
        callback(table);
      }),
    },
    raw: vi.fn((sql: string) => {
      rawCalls.push(sql);
      return `RAW:${sql}`;
    }),
  } as any;

  return { knex, tables, rawCalls };
}

describe('recurring service period invoice linkage migration', () => {
  it('adds additive invoice-linkage columns, unique detail linkage, and billed-state guards to the persisted ledger', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migration = await import(
      pathToFileURL(
        path.join(repoRoot, 'server/migrations/20260318143000_add_invoice_linkage_to_recurring_service_periods.cjs'),
      ).href,
    );

    const { knex, tables, rawCalls } = createFakeKnex();
    await migration.up(knex);

    const table = tables.get('recurring_service_periods');
    expect(table?.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'invoice_id',
      'invoice_charge_id',
      'invoice_charge_detail_id',
      'invoice_linked_at',
    ]));
    expect(table?.uniques).toContainEqual({
      columns: ['tenant', 'invoice_charge_detail_id'],
      name: 'recurring_service_periods_tenant_invoice_charge_detail_uidx',
    });
    expect(table?.indexes).toContainEqual({
      columns: ['tenant', 'invoice_id'],
      name: 'recurring_service_periods_tenant_invoice_linkage_idx',
    });

    const rawSql = rawCalls.join('\n');
    expect(rawSql).toContain('invoice_id IS NULL');
    expect(rawSql).toContain('invoice_charge_detail_id IS NOT NULL');
    expect(rawSql).toContain("CHECK (invoice_charge_detail_id IS NULL OR lifecycle_state = 'billed')");
  });
});
