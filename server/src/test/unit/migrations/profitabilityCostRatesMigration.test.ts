import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(testDir, '../../../..');
const require = createRequire(import.meta.url);
const createRatesPath = path.join(repoRoot, 'migrations/20260702120000_create_user_cost_rates.cjs');
const itemLinkPath = path.join(repoRoot, 'migrations/20260702120100_add_item_id_to_invoice_time_entries.cjs');

const createRatesMigration = require(createRatesPath) as {
  up: (knex: {
    schema: {
      createTable: (tableName: string, callback: (table: Record<string, unknown>) => void) => Promise<void>;
      raw: (sql: string) => Promise<void>;
    };
    raw: (sql: string) => Promise<{ rows?: Array<Record<string, unknown>> }>;
    fn: { now: () => string };
  }) => Promise<void>;
  config: { transaction: boolean };
};

function read(relativePath: string): string {
  return readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

describe('profitability labor-cost migrations', () => {
  const createRatesSource = read('migrations/20260702120000_create_user_cost_rates.cjs');
  const itemLinkSource = read('migrations/20260702120100_add_item_id_to_invoice_time_entries.cjs');

  it('creates user_cost_rates with the tenant-first PK, expected columns, and rate index', () => {
    expect(createRatesSource).toContain("createTable('user_cost_rates'");
    expect(createRatesSource).toContain("table.uuid('tenant').notNullable()");
    expect(createRatesSource).toContain("table.uuid('rate_id').notNullable().defaultTo(knex.raw('gen_random_uuid()'))");
    expect(createRatesSource).toContain("table.uuid('user_id').nullable()");
    expect(createRatesSource).toContain("table.bigInteger('cost_rate').notNullable()");
    expect(createRatesSource).toContain("table.date('effective_from').notNullable()");
    expect(createRatesSource).toContain("table.date('effective_to').nullable()");
    expect(createRatesSource).toContain("table.primary(['tenant', 'rate_id'])");
    expect(createRatesSource).toContain('user_cost_rates_tenant_user_effective_from_idx');
    expect(createRatesSource).toContain('ON user_cost_rates (tenant, user_id, effective_from)');
    expect(createRatesSource).toContain("dropTableIfExists('user_cost_rates')");
  });

  it('keeps user_cost_rates FK-free and enforces range/rate checks at the DB layer', () => {
    expect(createRatesSource).not.toContain('.references(');
    expect(createRatesSource).not.toContain('FOREIGN KEY');
    expect(createRatesSource).toContain('CHECK (cost_rate >= 0)');
    expect(createRatesSource).toContain('CHECK (effective_to IS NULL OR effective_to >= effective_from)');
    expect(createRatesMigration.config).toEqual({ transaction: false });
  });

  it('guards Citus distribution and skips cleanly when create_distributed_table is absent', async () => {
    const rawCalls: string[] = [];
    const knex = {
      fn: { now: () => 'now()' },
      schema: {
        createTable: vi.fn(async (_tableName: string, callback: (table: Record<string, unknown>) => void) => {
          const column = {
            notNullable: vi.fn(() => column),
            nullable: vi.fn(() => column),
            defaultTo: vi.fn(() => column),
          };
          callback({
            uuid: vi.fn(() => column),
            bigInteger: vi.fn(() => column),
            date: vi.fn(() => column),
            timestamp: vi.fn(() => column),
            primary: vi.fn(),
          });
        }),
        raw: vi.fn(async (sql: string) => {
          rawCalls.push(sql);
        }),
      },
      raw: vi.fn(async (sql: string) => {
        rawCalls.push(sql);
        return { rows: [{ exists: false }] };
      }),
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      await createRatesMigration.up(knex);
      expect(rawCalls.some((sql) => sql.includes('SELECT create_distributed_table'))).toBe(false);
      expect(warnSpy).toHaveBeenCalledWith(
        '[create_user_cost_rates] Skipping create_distributed_table (function unavailable)'
      );
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('adds invoice_time_entries.item_id as nullable with a tenant-scoped item index', () => {
    expect(itemLinkSource).toContain("hasColumn('invoice_time_entries', 'item_id')");
    expect(itemLinkSource).toContain("table.uuid('item_id').nullable()");
    expect(itemLinkSource).toContain('invoice_time_entries_tenant_item_id_idx');
    expect(itemLinkSource).toContain('ON invoice_time_entries (tenant, item_id)');
    expect(itemLinkSource).toContain("table.dropColumn('item_id')");
  });
});
