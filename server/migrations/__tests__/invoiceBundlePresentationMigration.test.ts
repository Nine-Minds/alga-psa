import { createRequire } from 'node:module';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);
const migration = require(path.resolve(__dirname, '../20261107120000_add_invoice_bundle_text_and_presentation.cjs'));

const schemaFixture = (tables: Record<string, string[]>) => {
  const columns = new Map(Object.entries(tables).map(([name, values]) => [name, new Set(values)]));
  const changes: string[] = [];
  const knex = {
    schema: {
      hasTable: async (table: string) => columns.has(table),
      hasColumn: async (table: string, column: string) => columns.get(table)?.has(column) ?? false,
      alterTable: async (table: string, apply: (builder: unknown) => void) => {
        const existing = columns.get(table);
        if (!existing) throw new Error(`Missing table ${table}`);
        const add = (type: string) => (column: string) => {
          if (existing.has(column)) throw new Error(`Duplicate column ${table}.${column}`);
          existing.add(column);
          return { nullable: () => { changes.push(`add ${table}.${column} ${type} nullable`); } };
        };
        apply({
          text: add('text'),
          jsonb: add('jsonb'),
          dropColumn: (column: string) => {
            if (!existing.delete(column)) throw new Error(`Missing column ${table}.${column}`);
            changes.push(`drop ${table}.${column}`);
          },
        });
      },
    },
  };
  return { knex, columns, changes };
};

describe('invoice bundle presentation migration', () => {
  it('adds nullable columns once and rolls them back once while preserving existing columns', async () => {
    const fixture = schemaFixture({ contract_lines: ['id'], contract_template_lines: ['id'], invoice_charges: ['id'] });
    await migration.up(fixture.knex);
    await migration.up(fixture.knex);
    expect(fixture.changes).toEqual([
      'add contract_lines.invoice_line_subtitle text nullable',
      'add contract_template_lines.invoice_line_description text nullable',
      'add contract_template_lines.invoice_line_subtitle text nullable',
      'add invoice_charges.bundle_presentation jsonb nullable',
    ]);

    await migration.down(fixture.knex);
    await migration.down(fixture.knex);
    expect(fixture.changes.slice(4)).toEqual([
      'drop invoice_charges.bundle_presentation',
      'drop contract_template_lines.invoice_line_subtitle',
      'drop contract_template_lines.invoice_line_description',
      'drop contract_lines.invoice_line_subtitle',
    ]);
    for (const columns of fixture.columns.values()) expect([...columns]).toEqual(['id']);
  });

  it('handles partial schemas and missing tables in both directions', async () => {
    const fixture = schemaFixture({ contract_template_lines: ['id', 'invoice_line_subtitle'] });
    await migration.up(fixture.knex);
    expect(fixture.changes).toEqual(['add contract_template_lines.invoice_line_description text nullable']);
    await migration.down(fixture.knex);
    expect([...fixture.columns.get('contract_template_lines')!]).toEqual(['id']);
    expect(fixture.columns.size).toBe(1);
  });
});
