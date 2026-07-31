import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require('../../../../migrations/20260716120000_add_barcode_to_service_catalog.cjs');

function createFakeKnex() {
  const addedColumns: Array<{ table: string; column: string; type: string; nullable: boolean }> = [];
  const droppedColumns: Array<{ table: string; column: string }> = [];
  const rawCalls: string[] = [];

  const knex = {
    schema: {
      alterTable: vi.fn(async (tableName: string, callback: (table: any) => void) => {
        const table = {
          text: (columnName: string) => ({
            nullable: () => {
              addedColumns.push({
                table: tableName,
                column: columnName,
                type: 'text',
                nullable: true,
              });
            },
          }),
          dropColumn: (columnName: string) => {
            droppedColumns.push({ table: tableName, column: columnName });
          },
        };

        callback(table);
      }),
    },
    raw: vi.fn(async (sql: string) => {
      rawCalls.push(sql);
    }),
  } as any;

  return { knex, addedColumns, droppedColumns, rawCalls };
}

describe('service catalog barcode migration', () => {
  it('adds the nullable barcode column and tenant-leading partial product index on up', async () => {
    const { knex, addedColumns, rawCalls } = createFakeKnex();

    await migration.up(knex);

    expect(addedColumns).toEqual([
      {
        table: 'service_catalog',
        column: 'barcode',
        type: 'text',
        nullable: true,
      },
    ]);

    const rawSql = rawCalls.join('\n');
    expect(rawSql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS service_catalog_product_barcode_unique');
    expect(rawSql).toContain('ON service_catalog (tenant, barcode)');
    expect(rawSql).toContain("WHERE barcode IS NOT NULL AND item_kind = 'product'");
  });

  it('drops the barcode index and column on down', async () => {
    const { knex, droppedColumns, rawCalls } = createFakeKnex();

    await migration.down(knex);

    expect(rawCalls.join('\n')).toContain(
      'DROP INDEX IF EXISTS service_catalog_product_barcode_unique',
    );
    expect(droppedColumns).toEqual([
      { table: 'service_catalog', column: 'barcode' },
    ]);
  });
});
