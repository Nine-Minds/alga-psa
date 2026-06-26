import { tenantDb } from '@alga-psa/db';
import type { Knex } from 'knex';

type TenantConnection = Knex | Knex.Transaction;
type TenantRow = Record<string, any>;

export function workflowTenantTable<Row extends object = TenantRow>(
  conn: TenantConnection,
  tenantId: string,
  table: string
): Knex.QueryBuilder<Row, Row[]> {
  return tenantDb(conn, tenantId).table<Row>(table);
}
