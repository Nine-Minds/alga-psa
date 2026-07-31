'use server';

import { withAuth, hasPermission } from '@alga-psa/auth';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IInteraction, IUserWithRoles } from '@alga-psa/types';

// MSP-only lookups: these actions back internal scheduling/time-entry UIs
// and expose tenant-wide client and interaction data, so client-portal
// callers (user_type 'client') are rejected and the caller must hold the
// matching read permission.
async function assertInternalReadAccess(user: IUserWithRoles, resource: 'client' | 'interaction'): Promise<void> {
  if (user.user_type !== 'internal') {
    throw new Error('Permission denied: scheduling lookup actions are internal-only');
  }
  if (!await hasPermission(user, resource, 'read')) {
    throw new Error(`Permission denied: cannot read ${resource}`);
  }
}

export const getSchedulingClients = withAuth(async (
  user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = (tenantDb(trx, tenant) as any).table('clients')
      .select('*')
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];
});

export const getSchedulingClientById = withAuth(async (
  user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  await assertInternalReadAccess(user, 'client');
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const result = await (tenantDb(trx, tenant) as any).table('clients')
      .select('*')
      .where({ client_id: clientId })
      .first();

    return (result ?? null) as IClient | null;
  });
});

export const getSchedulingInteractionById = withAuth(async (
  user,
  { tenant },
  interactionId: string
): Promise<IInteraction> => {
  await assertInternalReadAccess(user, 'interaction');
  const { knex } = await createTenantKnex();

  const interaction = await withTransaction(knex, async (trx: Knex.Transaction) => {
    const scopedDb = tenantDb(trx, tenant) as any;
    const query = scopedDb.table('interactions')
      .select(
        'interactions.*',
        trx.raw('COALESCE(it.type_name, sit.type_name) as type_name'),
        trx.raw('COALESCE(it.icon, sit.icon) as icon'),
        'contacts.full_name as contact_name',
        'clients.client_name',
        'users.username as user_name',
        'statuses.name as status_name',
        'statuses.is_closed as is_status_closed'
      );
    scopedDb.tenantJoin(query, 'interaction_types as it', 'interactions.type_id', 'it.type_id', { type: 'left' });
    query
      .leftJoin('system_interaction_types as sit', function (this: any) {
        this.on('interactions.type_id', '=', 'sit.type_id');
      });
    scopedDb.tenantJoin(query, 'contacts', 'interactions.contact_name_id', 'contacts.contact_name_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'clients', 'interactions.client_id', 'clients.client_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'users', 'interactions.user_id', 'users.user_id', { type: 'left' });
    scopedDb.tenantJoin(query, 'statuses', 'interactions.status_id', 'statuses.status_id', { type: 'left' });
    return query
      .where('interactions.interaction_id', interactionId)
      .first();
  });

  if (!interaction) {
    throw new Error('Interaction not found');
  }

  return {
    ...interaction,
    type_name: interaction.type_name?.toLowerCase() || null,
  } as IInteraction;
});
