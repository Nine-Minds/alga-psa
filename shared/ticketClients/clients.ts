import type { Knex } from 'knex';
import type { IClient } from '@alga-psa/types';

export async function getClientById(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  clientId: string
): Promise<IClient | null> {
  const client = await knexOrTrx<IClient>('clients')
    .where({ tenant, client_id: clientId })
    .first();

  if (!client) return null;
  return { ...client, properties: (client as any).properties ?? {} } as IClient;
}

export async function getAllClients(
  knexOrTrx: Knex | Knex.Transaction,
  tenant: string,
  includeInactive: boolean = true
): Promise<IClient[]> {
  const query = knexOrTrx<IClient>('clients')
    .where({ tenant })
    .orderBy('client_name', 'asc')
    .select('*');

  if (!includeInactive) {
    query.andWhere({ is_inactive: false });
  }

  const rows = await query;
  return rows.map((c) => ({ ...c, properties: (c as any).properties ?? {} } as IClient));
}

