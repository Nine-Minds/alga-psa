'use server'

import { IClientSummary } from 'server/src/interfaces/client.interfaces';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/shared/db';
import { Knex } from 'knex';

export async function getClients(): Promise<Omit<IClientSummary, "tenant">[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const clients = await withTransaction(db, async (trx: Knex.Transaction) => {
      return await trx('clients')
        .select(
          'clients.client_id',
          'clients.client_name',
          'billing_plans.plan_id',
          'billing_plans.plan_name',
          'billing_plans.billing_frequency',
          'billing_plans.is_custom',
          'billing_plans.plan_type'
        )
        .where('clients.tenant', tenant)
        .leftJoin('client_billing', function() {
          this.on('clients.client_id', '=', 'client_billing.client_id')
              .andOn('clients.tenant', '=', 'client_billing.tenant');
        })
        .leftJoin('billing_plans', function() {
          this.on('client_billing.plan_id', '=', 'billing_plans.plan_id')
              .andOn('client_billing.tenant', '=', 'billing_plans.tenant');
        });
    });
    
    return clients.map((client): Omit<IClientSummary, "tenant"> => ({
      id: client.client_id,
      name: client.client_name,
      billingPlan: client.plan_id ? {
        plan_id: client.plan_id,
        plan_name: client.plan_name,
        billing_frequency: client.billing_frequency,
        is_custom: client.is_custom,
        plan_type: client.plan_type
      } : undefined
    }));
  } catch (error) {
    console.error('Error fetching clients:', error);
    throw new Error('Failed to fetch clients');
  }
}
