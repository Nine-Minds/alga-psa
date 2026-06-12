import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migrationPath = path.resolve(
  __dirname,
  '../../../../server/migrations/20260604120000_create_workflow_data_store_tables.cjs',
);
const migration = require(migrationPath);

type TableCall = {
  table: string;
  method: string;
  args: unknown[];
};

function chainableColumn() {
  const column: Record<string, (...args: unknown[]) => typeof column> = {};
  for (const method of ['notNullable', 'nullable', 'defaultTo', 'references', 'inTable']) {
    column[method] = () => column;
  }
  return column;
}

function createFakeKnex(options: { citusEnabled: boolean; alreadyDistributed?: boolean }) {
  const createdTables: string[] = [];
  const droppedTables: string[] = [];
  const tableCalls: TableCall[] = [];
  const rawCalls: Array<{ sql: string; bindings?: unknown[] }> = [];

  const knex = {
    fn: {
      now: () => 'now()',
    },
    schema: {
      createTable: vi.fn(async (tableName: string, callback: (table: any) => void) => {
        createdTables.push(tableName);
        const table = new Proxy({}, {
          get: (_target, method: string) => (...args: unknown[]) => {
            tableCalls.push({ table: tableName, method, args });
            return ['uuid', 'text', 'jsonb', 'bigInteger', 'timestamp'].includes(method)
              ? chainableColumn()
              : undefined;
          },
        });
        callback(table);
      }),
      dropTableIfExists: vi.fn(async (tableName: string) => {
        droppedTables.push(tableName);
      }),
    },
    raw: vi.fn(async (sql: string, bindings?: unknown[]) => {
      rawCalls.push({ sql, bindings });
      if (sql.includes('FROM pg_extension')) {
        return { rows: [{ enabled: options.citusEnabled }] };
      }
      if (sql.includes('FROM pg_dist_partition')) {
        return { rows: [{ is_distributed: options.alreadyDistributed ?? false }] };
      }
      return { rows: [] };
    }),
  };

  return { knex, createdTables, droppedTables, tableCalls, rawCalls };
}

describe('workflow data-store migration contract', () => {
  it('T013: creates tenant-leading tables and skips distribution when Citus is unavailable', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { knex, createdTables, tableCalls, rawCalls } = createFakeKnex({ citusEnabled: false });

    await migration.up(knex);

    expect(createdTables).toEqual(['workflow_data_store', 'workflow_entity_links']);
    expect(tableCalls).toContainEqual(expect.objectContaining({
      table: 'workflow_data_store',
      method: 'primary',
      args: [['tenant', 'store_id']],
    }));
    expect(tableCalls).toContainEqual(expect.objectContaining({
      table: 'workflow_data_store',
      method: 'unique',
      args: [['tenant', 'namespace', 'key'], 'workflow_data_store_tenant_namespace_key_uk'],
    }));
    expect(tableCalls).toContainEqual(expect.objectContaining({
      table: 'workflow_entity_links',
      method: 'primary',
      args: [['tenant', 'link_id']],
    }));
    expect(tableCalls).toContainEqual(expect.objectContaining({
      table: 'workflow_entity_links',
      method: 'unique',
      args: [[
        'tenant',
        'namespace',
        'left_type',
        'left_id',
        'right_type',
        'right_id',
        'relation',
      ], 'workflow_entity_links_tenant_typed_edge_uk'],
    }));
    expect(rawCalls.some((call) => call.sql.includes('create_distributed_table'))).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Skipping create_distributed_table'));

    warnSpy.mockRestore();
  });

  it('T013: distributes both tables colocated with workflow_runs when Citus is enabled', async () => {
    const { knex, rawCalls } = createFakeKnex({ citusEnabled: true });

    await migration.up(knex);

    const distributionCalls = rawCalls.filter((call) => call.sql.includes('create_distributed_table'));
    expect(distributionCalls).toEqual([
      {
        sql: "SELECT create_distributed_table(?, 'tenant', colocate_with => 'workflow_runs')",
        bindings: ['workflow_data_store'],
      },
      {
        sql: "SELECT create_distributed_table(?, 'tenant', colocate_with => 'workflow_runs')",
        bindings: ['workflow_entity_links'],
      },
    ]);
  });

  it('T013: down drops links before KV rows and migration runs outside transactions', async () => {
    const { knex, droppedTables } = createFakeKnex({ citusEnabled: false });

    await migration.down(knex);

    expect(droppedTables).toEqual(['workflow_entity_links', 'workflow_data_store']);
    expect(migration.config).toEqual({ transaction: false });
  });
});
