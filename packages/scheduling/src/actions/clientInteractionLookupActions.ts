'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import type { Knex } from 'knex';
import type { IClient, IInteraction } from '@alga-psa/types';

export const getSchedulingClients = withAuth(async (
  _user,
  { tenant },
  includeInactive: boolean = true
): Promise<IClient[]> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const query = trx('clients')
      .select('*')
      .where('tenant', tenant)
      .orderBy('client_name', 'asc');

    if (!includeInactive) {
      query.andWhere({ is_inactive: false });
    }

    return query;
  }) as unknown as IClient[];
});

export const getSchedulingClientById = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<IClient | null> => {
  const { knex } = await createTenantKnex();

  return withTransaction(knex, async (trx: Knex.Transaction) => {
    const result = await trx('clients')
      .select('*')
      .where({ client_id: clientId, tenant })
      .first();

    return (result ?? null) as IClient | null;
  });
});

export const getSchedulingInteractionById = withAuth(async (
  _user,
  { tenant },
  interactionId: string
): Promise<IInteraction> => {
  const { knex } = await createTenantKnex();

  const interaction = await withTransaction(knex, async (trx: Knex.Transaction) => {
    return trx('interactions')
      .where('interactions.tenant', tenant)
      .select(
        'interactions.*',
        trx.raw('COALESCE(it.type_name, sit.type_name) as type_name'),
        trx.raw('COALESCE(it.icon, sit.icon) as icon'),
        'contacts.full_name as contact_name',
        'clients.client_name',
        'users.username as user_name',
        'statuses.name as status_name',
        'statuses.is_closed as is_status_closed'
      )
      .leftJoin('interaction_types as it', function () {
        this.on('interactions.type_id', '=', 'it.type_id')
          .andOn('interactions.tenant', '=', 'it.tenant');
      })
      .leftJoin('system_interaction_types as sit', function () {
        this.on('interactions.type_id', '=', 'sit.type_id');
      })
      .leftJoin('contacts', function () {
        this.on('interactions.contact_name_id', '=', 'contacts.contact_name_id')
          .andOn('interactions.tenant', '=', 'contacts.tenant');
      })
      .leftJoin('clients', function () {
        this.on('interactions.client_id', '=', 'clients.client_id')
          .andOn('interactions.tenant', '=', 'clients.tenant');
      })
      .leftJoin('users', function () {
        this.on('interactions.user_id', '=', 'users.user_id')
          .andOn('interactions.tenant', '=', 'users.tenant');
      })
      .leftJoin('statuses', function () {
        this.on('interactions.status_id', '=', 'statuses.status_id')
          .andOn('interactions.tenant', '=', 'statuses.tenant');
      })
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
