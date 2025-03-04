'use server'

import { IClient } from 'server/src/interfaces/client.interfaces';
import { createTenantKnex } from 'server/src/lib/db';

export async function getClients(): Promise<Omit<IClient, "tenant">[]> {
  try {
    const {knex: db, tenant} = await createTenantKnex();
    if (!tenant) {
      throw new Error('Tenant not found');
    }

    const clients = await db('companies')
      .select(
        'companies.company_id',
        'companies.company_name',
        'billing_plans.plan_id',
        'billing_plans.plan_name',
        'billing_plans.billing_frequency',
        'billing_plans.is_custom',
        'billing_plans.plan_type'
      )
      .where('companies.tenant', tenant)
      .leftJoin('client_billing', function() {
        this.on('companies.company_id', '=', 'client_billing.company_id')
            .andOn('companies.tenant', '=', 'client_billing.tenant');
      })
      .leftJoin('billing_plans', function() {
        this.on('client_billing.plan_id', '=', 'billing_plans.plan_id')
            .andOn('client_billing.tenant', '=', 'billing_plans.tenant');
      });
    
    return clients.map((company): Omit<IClient, "tenant"> => ({
      id: company.company_id,
      name: company.company_name,
      billingPlan: company.plan_id ? {
        plan_id: company.plan_id,
        plan_name: company.plan_name,
        billing_frequency: company.billing_frequency,
        is_custom: company.is_custom,
        plan_type: company.plan_type
      } : undefined
    }));
  } catch (error) {
    console.error('Error fetching clients:', error);
    throw new Error('Failed to fetch clients');
  }
}
