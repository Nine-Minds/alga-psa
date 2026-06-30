import type { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import type { IClient } from '@alga-psa/types';

function tenantScopedTable(
  conn: Knex | Knex.Transaction,
  tenant: string,
  table: string,
): Knex.QueryBuilder<any, any> {
  return tenantDb(conn, tenant).table(table) as Knex.QueryBuilder<any, any>;
}

export async function getClientById(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClient | null> {
  const client = await tenantScopedTable(knexOrTrx, tenant, 'clients')
    .where({ client_id: clientId })
    .first();

  if (!client) return null;
  return { ...client, properties: (client as any).properties ?? {} } as IClient;
}

export async function getAllClients(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  includeInactive: boolean = true
): Promise<IClient[]> {
  const query = tenantScopedTable(knexOrTrx, tenant, 'clients')
    .orderBy('client_name', 'asc')
    .select('*');

  if (!includeInactive) {
    query.andWhere({ is_inactive: false });
  }

  const rows = await query as Array<Record<string, any>>;
  return rows.map((c) => ({ ...c, properties: (c as any).properties ?? {} } as IClient));
}
