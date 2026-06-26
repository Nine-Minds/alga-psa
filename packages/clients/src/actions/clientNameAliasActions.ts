'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import { assertMspPermission } from '../lib/authHelpers';
import { v4 as uuidv4 } from 'uuid';

export interface ClientNameAlias {
  id: string;
  client_id: string;
  alias: string;
  created_at?: string;
}

function normalizeAliasInput(raw: string): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

async function findAliasOwner(
  trx: Knex.Transaction,
  tenant: string,
  alias: string
): Promise<{ client_id: string; client_name: string } | null> {
  const db = tenantDb(trx, tenant);
  const query = db.table('client_name_aliases as a')
    .select('a.client_id', 'c.client_name')
    .andWhereRaw('lower(a.alias) = ?', [alias.toLowerCase()]);
  db.tenantJoin(query, 'clients as c', 'a.client_id', 'c.client_id', { type: 'left' });

  const row = await query.first();

  const clientId = (row as any)?.client_id;
  const clientName = (row as any)?.client_name;
  if (typeof clientId !== 'string' || !clientId) return null;
  return {
    client_id: clientId,
    client_name: typeof clientName === 'string' && clientName ? clientName : clientId,
  };
}

export const listClientNameAliases = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<ClientNameAlias[]> => {
  await assertMspPermission(user, 'client', 'read', 'Permission denied: Cannot read clients');

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const rows = await tenantDb(trx, tenant).table('client_name_aliases')
      .select('id', 'client_id', 'alias', 'created_at')
      .where({ client_id: clientId })
      .orderBy('alias', 'asc');
    return rows as any;
  });
});

export const addClientNameAlias = withAuth(async (
  user,
  { tenant },
  clientId: string,
  rawAlias: string
): Promise<ClientNameAlias> => {
  await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot update clients');

  const alias = normalizeAliasInput(rawAlias);
  if (!alias) {
    throw new Error('Alias is required');
  }
  if (alias.length > 255) {
    throw new Error('Alias is too long');
  }

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    try {
      const id = uuidv4();
      const now = new Date().toISOString();
      const [row] = await tenantDb(trx, tenant).table('client_name_aliases')
        .insert({
          tenant,
          id,
          client_id: clientId,
          alias,
          created_at: now,
          updated_at: now,
        })
        .returning(['id', 'client_id', 'alias', 'created_at']);
      return row as any;
    } catch (e: any) {
      // Uniqueness (tenant, lower(alias))
      if (String(e?.code ?? '') === '23505') {
        const owner = await findAliasOwner(trx, tenant, alias);
        if (owner && owner.client_id !== clientId) {
          throw new Error(`Alias "${alias}" is already assigned to client "${owner.client_name}".`);
        }
        throw new Error(`Alias "${alias}" is already assigned to a client.`);
      }
      throw e;
    }
  });
});

export const removeClientNameAlias = withAuth(async (
  user,
  { tenant },
  clientId: string,
  aliasId: string
): Promise<{ success: true }> => {
  await assertMspPermission(user, 'client', 'update', 'Permission denied: Cannot update clients');

  const { knex } = await createTenantKnex();
  return withTransaction(knex, async (trx: Knex.Transaction) => {
    await tenantDb(trx, tenant).table('client_name_aliases')
      .where({ client_id: clientId, id: aliasId })
      .delete();
    return { success: true as const };
  });
});
