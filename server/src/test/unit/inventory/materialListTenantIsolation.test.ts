import { afterAll, describe, expect, it, vi } from 'vitest';
import knexFactory, { type Knex } from 'knex';

vi.mock('@alga-psa/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@alga-psa/db')>()),
  withTransaction: async (connection: Knex, callback: (trx: Knex) => Promise<unknown>) => callback(connection),
}));

import { listMaterials } from '@alga-psa/inventory/lib';

const compiler = knexFactory({ client: 'pg' });

afterAll(async () => {
  await compiler.destroy();
});

function captureQueries() {
  const queries: Array<{ sql: string; bindings: readonly unknown[] }> = [];
  const connection = new Proxy(compiler, {
    apply(target, thisArg, argumentsList) {
      const builder: Knex.QueryBuilder = Reflect.apply(target, thisArg, argumentsList);
      Object.defineProperty(builder, 'then', {
        value: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
          const { sql, bindings } = builder.toSQL();
          queries.push({ sql, bindings });
          return Promise.resolve([]).then(resolve, reject);
        },
      });
      return builder;
    },
  });
  return { connection, queries };
}

describe('material list tenant isolation', () => {
  it.each([
    { type: 'ticket' as const, table: 'ticket_materials', parentColumn: 'ticket_id', sourceType: 'ticket_material' },
    { type: 'project' as const, table: 'project_materials', parentColumn: 'project_id', sourceType: 'project_material' },
  ])('scopes the $type material root, joins, and serialized movement lookup', async ({ type, table, parentColumn, sourceType }) => {
    const { connection, queries } = captureQueries();

    await expect(listMaterials(connection, 'tenant-1', type, 'parent-1')).resolves.toEqual([]);

    expect(queries).toHaveLength(1);
    const [{ sql, bindings }] = queries;
    expect(sql).toContain(`from "${table}" as "m"`);
    expect(sql).toContain(`where "m"."tenant" = ? and "m"."${parentColumn}" = ?`);
    expect(sql).toContain('left join "service_catalog" as "sc" on "m"."service_id" = "sc"."service_id" and "sc"."tenant" = "m"."tenant"');
    expect(sql).toContain('left join "product_inventory_settings" as "pis" on "m"."service_id" = "pis"."service_id" and "pis"."tenant" = "m"."tenant"');
    expect(sql).toMatch(/WHERE sm\.tenant = m\.tenant AND sm\.source_doc_type = \?/);
    expect(bindings).toEqual([sourceType, 'tenant-1', 'parent-1']);
    if (type === 'project') {
      expect(sql).toContain('left join "project_staging_lines" as "psl" on "m"."project_material_id" = "psl"."project_material_id" and "psl"."tenant" = "m"."tenant"');
    }
  });
});
