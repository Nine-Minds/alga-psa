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
      // Some environments have renamed client_billing -> company_billing_plans.
      // Detect available table to keep compatibility.
      const hasClientBillingPlans = await trx.schema.hasTable('client_billing_plans');
      const hasCompanyBilling = await trx.schema.hasTable('company_billing_plans');
      const hasClientBilling = await trx.schema.hasTable('client_billing');
      const billingTable = hasClientBillingPlans
        ? 'client_billing_plans'
        : (hasCompanyBilling
            ? 'company_billing_plans'
            : (hasClientBilling ? 'client_billing' : null));

      let query = trx('clients')
        .select(
          'clients.client_id',
          'clients.client_name',
          'billing_plans.plan_id',
          'billing_plans.plan_name',
          'billing_plans.billing_frequency',
          'billing_plans.is_custom',
          'billing_plans.plan_type'
        )
        .where('clients.tenant', tenant as string);

      if (billingTable) {
        // Join via alias so we can reference consistently
        query = query
          .leftJoin({ cb: billingTable }, function() {
            this.on('clients.client_id', '=', 'cb.client_id')
                .andOn('clients.tenant', '=', 'cb.tenant');
          })
          .leftJoin('billing_plans', function() {
            this.on('cb.plan_id', '=', 'billing_plans.plan_id')
                .andOn('cb.tenant', '=', 'billing_plans.tenant');
          });
      }

      return await query;
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
