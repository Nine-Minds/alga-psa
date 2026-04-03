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
  primaryKey: string[] | null = null;

  private addColumn(type: string, name: string) {
    const column: ColumnRecord = { name, type };
    this.columns.push(column);
    return new FakeColumnBuilder(column);
  }

  uuid(name: string) {
    return this.addColumn('uuid', name);
  }

  string(name: string) {
    return this.addColumn('string', name);
  }

  integer(name: string) {
    return this.addColumn('integer', name);
  }

  date(name: string) {
    return this.addColumn('date', name);
  }

  timestamp(name: string) {
    return this.addColumn('timestamp', name);
  }

  jsonb(name: string) {
    return this.addColumn('jsonb', name);
  }

  primary(columns: string[]) {
    this.primaryKey = columns;
  }

  unique(columns: string[], name: string) {
    this.uniques.push({ columns, name });
  }

  index(columns: string[], name: string) {
    this.indexes.push({ columns, name });
  }
}

function createFakeKnex() {
  const tables = new Map<string, FakeTableBuilder>();
  const rawCalls: string[] = [];
  const droppedTables: string[] = [];

  const knex = {
    schema: {
      hasTable: vi.fn(async () => false),
      createTable: vi.fn(async (tableName: string, callback: (table: FakeTableBuilder) => void) => {
        const table = new FakeTableBuilder();
        callback(table);
        tables.set(tableName, table);
      }),
      dropTableIfExists: vi.fn(async (tableName: string) => {
        droppedTables.push(tableName);
      }),
    },
    raw: vi.fn((sql: string) => {
      rawCalls.push(sql);
      return `RAW:${sql}`;
    }),
    fn: {
      now: () => 'NOW()',
    },
  } as any;

  return { knex, tables, rawCalls, droppedTables };
}

describe('recurring service periods migration', () => {
  it('T282: migration adds persisted service-period constraints that reject invalid cadence, provenance, and boundary records', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migration = await import(
      pathToFileURL(
        path.join(repoRoot, 'server/migrations/20260318120000_create_recurring_service_periods.cjs'),
      ).href
    );

    const { knex, tables, rawCalls } = createFakeKnex();
    await migration.up(knex);

    const table = tables.get('recurring_service_periods');
    expect(table).toBeDefined();
    expect(table?.columns.map((column) => column.name)).toEqual(expect.arrayContaining([
      'record_id',
      'tenant',
      'schedule_key',
      'period_key',
      'revision',
      'obligation_id',
      'obligation_type',
      'charge_family',
      'cadence_owner',
      'due_position',
      'lifecycle_state',
      'service_period_start',
      'service_period_end',
      'invoice_window_start',
      'invoice_window_end',
      'activity_window_start',
      'activity_window_end',
      'timing_metadata',
      'provenance_kind',
      'source_rule_version',
      'supersedes_record_id',
    ]));

    const rawSql = rawCalls.join('\n');
    expect(rawSql).toContain("CHECK (cadence_owner IN ('client', 'contract'))");
    expect(rawSql).toContain("CHECK (due_position IN ('advance', 'arrears'))");
    expect(rawSql).toContain("CHECK (charge_family IN ('fixed', 'product', 'license', 'bucket', 'hourly', 'usage'))");
    expect(rawSql).toContain("CHECK (provenance_kind IN ('generated', 'user_edited', 'regenerated', 'repair'))");
    expect(rawSql).toContain('CHECK (service_period_start < service_period_end)');
    expect(rawSql).toContain('CHECK (invoice_window_start < invoice_window_end)');
    expect(rawSql).toContain('activity_window_start >= service_period_start');
    expect(rawSql).toContain('supersedes_record_id IS NULL OR supersedes_record_id <> record_id');
  });

  it('T017/T018: migration widens persisted recurring service-period charge families so hourly and usage obligations can participate in service-driven selection', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migration = await import(
      pathToFileURL(
        path.join(repoRoot, 'server/migrations/20260318120000_create_recurring_service_periods.cjs'),
      ).href
    );

    const { knex, rawCalls } = createFakeKnex();
    await migration.up(knex);

    const rawSql = rawCalls.join('\n');
    expect(rawSql).toContain("CHECK (charge_family IN ('fixed', 'product', 'license', 'bucket', 'hourly', 'usage'))");
  });

  it('T342: migration adds persisted service-period indexes for schedule lookup, obligation-state scans, and due selection', async () => {
    const repoRoot = path.resolve(import.meta.dirname, '../../../../..');
    const migration = await import(
      pathToFileURL(
        path.join(repoRoot, 'server/migrations/20260318120000_create_recurring_service_periods.cjs'),
      ).href
    );

    const { knex, tables } = createFakeKnex();
    await migration.up(knex);

    const table = tables.get('recurring_service_periods');
    expect(table?.primaryKey).toEqual(['tenant', 'record_id']);
    expect(table?.uniques).toContainEqual({
      columns: ['tenant', 'schedule_key', 'period_key', 'revision'],
      name: 'recurring_service_periods_tenant_schedule_period_revision_uidx',
    });
    expect(table?.indexes).toContainEqual({
      columns: ['tenant', 'schedule_key', 'service_period_start'],
      name: 'recurring_service_periods_tenant_schedule_start_idx',
    });
    expect(table?.indexes).toContainEqual({
      columns: ['tenant', 'obligation_id', 'lifecycle_state'],
      name: 'recurring_service_periods_tenant_obligation_state_idx',
    });
    expect(table?.indexes).toContainEqual({
      columns: ['tenant', 'lifecycle_state', 'invoice_window_start', 'invoice_window_end'],
      name: 'recurring_service_periods_tenant_due_selection_idx',
    });
  });
});
