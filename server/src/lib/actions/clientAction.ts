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
      const hasClientContractLines = await trx.schema.hasTable('client_contract_lines');
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

      if (hasClientContractLines) {
        return await trx('clients')
          .select(
            'clients.client_id',
            'clients.client_name',
            'contract_lines.contract_line_id',
            'contract_lines.contract_line_name',
            'contract_lines.billing_frequency',
            'contract_lines.is_custom',
            'contract_lines.contract_line_type'
          )
          .where('clients.tenant', tenant)
          .leftJoin('client_contract_lines', function(this: Knex.JoinClause) {
            this.on('clients.client_id', '=', 'client_contract_lines.client_id')
                .andOn('clients.tenant', '=', 'client_contract_lines.tenant');
          })
          .leftJoin('contract_lines', function(this: Knex.JoinClause) {
            this.on('client_contract_lines.contract_line_id', '=', 'contract_lines.contract_line_id')
                .andOn('client_contract_lines.tenant', '=', 'contract_lines.tenant');
          });
      }

      let query = trx('clients')
        .select(
          'clients.client_id',
          'clients.client_name'
        )
        .where('clients.tenant', tenant);

      if (billingTable) {
        const hasContractLineIdColumn = await trx.schema.hasColumn(billingTable, 'contract_line_id');
        const hasPlanIdColumn = await trx.schema.hasColumn(billingTable, 'plan_id');

        query = query
          .leftJoin(billingTable, function(this: Knex.JoinClause) {
            this.on('clients.client_id', '=', `${billingTable}.client_id`)
                .andOn('clients.tenant', '=', `${billingTable}.tenant`);
          });

        if (hasContractLineIdColumn) {
          query = query
            .leftJoin('contract_lines', function(this: Knex.JoinClause) {
              this.on(`${billingTable}.contract_line_id`, '=', 'contract_lines.contract_line_id')
                  .andOn(`${billingTable}.tenant`, '=', 'contract_lines.tenant');
            })
            .select(
              'contract_lines.contract_line_id',
              'contract_lines.contract_line_name',
              'contract_lines.billing_frequency',
              'contract_lines.is_custom',
              'contract_lines.contract_line_type'
            );
        } else if (hasPlanIdColumn) {
          query = query
            .leftJoin('billing_plans', function(this: Knex.JoinClause) {
              this.on(`${billingTable}.plan_id`, '=', 'billing_plans.plan_id')
                  .andOn(`${billingTable}.tenant`, '=', 'billing_plans.tenant');
            })
            .select(
              trx.raw('"billing_plans"."plan_id" as legacy_plan_id'),
              trx.raw('"billing_plans"."plan_name" as legacy_plan_name'),
              trx.raw('"billing_plans"."billing_frequency" as legacy_billing_frequency'),
              trx.raw('"billing_plans"."is_custom" as legacy_is_custom'),
              trx.raw('"billing_plans"."plan_type" as legacy_contract_line_type')
            );
        }
      }
      return await query;
    });

    return clients.map((client): Omit<IClientSummary, "tenant"> => ({
      id: client.client_id,
      name: client.client_name,
      contractLine: (
        client.contract_line_id
          ? {
              contract_line_id: client.contract_line_id,
              contract_line_name: client.contract_line_name,
              billing_frequency: client.billing_frequency,
              is_custom: client.is_custom,
              contract_line_type: client.contract_line_type
            }
          : client.legacy_plan_id
            ? {
                contract_line_id: client.legacy_plan_id,
                contract_line_name: client.legacy_plan_name,
                billing_frequency: client.legacy_billing_frequency,
                is_custom: client.legacy_is_custom,
                contract_line_type: client.legacy_contract_line_type
              }
            : undefined
      )
    }));
  } catch (error) {
    console.error('Error fetching clients:', error);
    throw new Error('Failed to fetch clients');
  }
}
