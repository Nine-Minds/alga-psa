import { readFileSync } from 'fs';
import knexFactory from 'knex';
import type { Knex } from 'knex';
import { afterAll, describe, expect, it } from 'vitest';
import { QueryBuilder } from './QueryBuilder';

const packageSource = readFileSync(new URL('./QueryBuilder.ts', import.meta.url), 'utf8');
const serverSource = readFileSync(
  new URL('../../../../../../server/src/lib/reports/builders/QueryBuilder.ts', import.meta.url),
  'utf8'
);
const knex = knexFactory({ client: 'pg' });

afterAll(async () => {
  await knex.destroy();
});

describe('report QueryBuilder tenant facade wiring', () => {
  it.each([
    ['package reporting builder', packageSource],
    ['server reporting builder', serverSource],
  ])('%s routes regular roots and tenant joins through tenantDb', (_label, source) => {
    expect(source).toMatch(/import \{[^}]*tenantDb[^}]*\} from '@alga-psa\/db';/s);
    expect(source).toContain('return tenantDb(trx, tenant).table(queryDef.table);');
    expect(source).toContain('return tenantDb(trx, tenant).tenantJoin(');
    expect(source).toContain('private static isTenantScopeFilter(');
    expect(source).toContain('private static isTenantEqualityJoinCondition(');

    expect(source).not.toContain('let query = trx(queryDef.table);');
    expect(source).not.toContain('this.applyJoin(query, join);');
  });

  it.each([
    ['package reporting builder', packageSource],
    ['server reporting builder', serverSource],
  ])('%s routes raw SQL tenant-table placeholders through tenantDb', (_label, source) => {
    expect(source).toContain('parseTableExpression');
    expect(source).toContain('getTenantTableScope');
    expect(source).toContain("placeholder.startsWith('tenant_table:')");
    expect(source).toContain("tenantDb(trx, tenant)");
    expect(source).toContain(".table(tableExpression)");
    expect(source).toContain(".select('*')");
    expect(source).toContain('.toSQL()');
  });

  it('expands raw SQL tenant-table placeholders as derived tenant-scoped tables in binding order', () => {
    const query = QueryBuilder.build(
      knex as unknown as Knex.Transaction,
      {
        table: 'raw_sql',
        fields: [`
          SELECT ic.item_id, {{label}} AS label
          FROM {{tenant_table:invoice_charges AS ic}}
          JOIN {{tenant_table:invoices AS inv}}
            ON inv.invoice_id = ic.invoice_id
          WHERE ic.item_id = {{item_id}}
            AND inv.invoice_date >= {{start_of_year}}
        `],
      },
      {
        tenant: 'tenant-1',
        label: 'YTD',
        item_id: 'item-1',
        start_of_year: '2026-01-01',
      }
    );

    const compiled = (query as any).toSQL();

    expect(compiled.sql).toContain(
      '(select * from "invoice_charges" as "ic" where "ic"."tenant" = ?) as "ic"'
    );
    expect(compiled.sql).toContain(
      '(select * from "invoices" as "inv" where "inv"."tenant" = ?) as "inv"'
    );
    expect(compiled.bindings).toEqual(['YTD', 'tenant-1', 'tenant-1', 'item-1', '2026-01-01']);
  });

  it('rejects unsafe raw SQL tenant-table placeholders', () => {
    expect(() => QueryBuilder.build(
      knex as unknown as Knex.Transaction,
      {
        table: 'raw_sql',
        fields: ['SELECT * FROM {{tenant_table:invoice_charges AS ic JOIN invoices AS inv}}'],
      },
      { tenant: 'tenant-1' }
    )).toThrow(/Raw SQL tenant table expression/);
  });
});
