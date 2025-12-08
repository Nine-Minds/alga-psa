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
      // Query via clients -> client_contracts -> contracts -> contract_lines
      // (contracts are client-specific via client_contracts)
      return await trx('clients')
        .select(
          'clients.client_id',
          'clients.client_name',
          'cl.contract_line_id',
          'cl.contract_line_name',
          'cl.billing_frequency',
          'cl.is_custom',
          'cl.contract_line_type'
        )
        .where('clients.tenant', tenant)
        .leftJoin('client_contracts as cc', function(this: Knex.JoinClause) {
          this.on('clients.client_id', '=', 'cc.client_id')
              .andOn('clients.tenant', '=', 'cc.tenant');
        })
        .leftJoin('contracts as c', function(this: Knex.JoinClause) {
          this.on('cc.contract_id', '=', 'c.contract_id')
              .andOn('cc.tenant', '=', 'c.tenant');
        })
        .leftJoin('contract_lines as cl', function(this: Knex.JoinClause) {
          this.on('c.contract_id', '=', 'cl.contract_id')
              .andOn('c.tenant', '=', 'cl.tenant');
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
