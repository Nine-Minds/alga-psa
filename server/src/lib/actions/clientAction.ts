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
      if (!hasClientContractLines) {
        throw new Error('client_contract_lines table not found. Run the latest contract migrations.');
      }

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
    });

    // Deduplicate clients - the left joins create one row per contract line
    const uniqueClientsMap = new Map<string, Omit<IClientSummary, "tenant">>();

    clients.forEach((client) => {
      if (!uniqueClientsMap.has(client.client_id)) {
        uniqueClientsMap.set(client.client_id, {
          id: client.client_id,
          name: client.client_name,
          contractLine: client.contract_line_id
            ? {
                contract_line_id: client.contract_line_id,
                contract_line_name: client.contract_line_name,
                billing_frequency: client.billing_frequency,
                is_custom: client.is_custom,
                contract_line_type: client.contract_line_type
              }
            : undefined
        });
      }
    });

    return Array.from(uniqueClientsMap.values());
  } catch (error) {
    console.error('Error fetching clients:', error);
    throw new Error('Failed to fetch clients');
  }
}
