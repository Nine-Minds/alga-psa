import { createTenantScopedQuery } from '@alga-psa/db';
import type { Knex } from 'knex';

export function createTenantScopedIndexerQuery<Row extends object>(
  knex: Knex,
  table: string,
  alias: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return createTenantScopedQuery(knex, { table, alias, tenant }).builder as Knex.QueryBuilder<Row, Row[]>;
}
