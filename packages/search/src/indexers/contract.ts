import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ContractSearchRow {
  contract_id: string;
  contract_name: string;
  contract_description: string | null;
  status: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ContractSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ContractSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'contract',
    objectId: row.contract_id,
    title: row.contract_name,
    subtitle: row.status === 'draft' ? 'Quote' : 'Contract',
    body: row.contract_description ?? undefined,
    url: `/msp/billing/contracts/${row.contract_id}`,
    metadata: { identifier: row.contract_name },
    acl: {
      requiredPermission: 'contract:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const contractIndexer: EntityIndexer = {
  objectType: 'contract',
  sourceEvents: ['CONTRACT_CREATED', 'CONTRACT_UPDATED', 'CONTRACT_DELETED', 'CONTRACT_STATUS_CHANGED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<ContractSearchRow>(knex, 'contracts', 'contracts', tenant)
      .select('contract_id', 'contract_name', 'contract_description', 'status', 'created_at', 'updated_at')
      .andWhere('contract_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<ContractSearchRow>(knex, 'contracts', 'contracts', tenant)
      .select('contract_id', 'contract_name', 'contract_description', 'status', 'created_at', 'updated_at')
      .orderBy('contract_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('contract_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
