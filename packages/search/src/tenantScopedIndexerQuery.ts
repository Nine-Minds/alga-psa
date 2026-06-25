import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

export function createTenantScopedIndexerQuery<Row extends object>(
  knex: Knex,
  table: string,
  alias: string,
  tenant: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(knex, tenant).table<Row>(alias ? `${table} as ${alias}` : table);
}
