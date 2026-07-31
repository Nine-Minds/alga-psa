import type { Knex } from 'knex';

import { createTenantScopedIndexerQuery } from '../tenantScopedIndexerQuery';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ServiceRequestDefinitionSearchRow {
  definition_id: string;
  name: string;
  description: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function toSourceUpdatedAt(row: ServiceRequestDefinitionSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ServiceRequestDefinitionSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'service_request_definition',
    objectId: row.definition_id,
    title: row.name,
    body: row.description ?? undefined,
    url: `/msp/service-requests/definitions/${row.definition_id}`,
    acl: {
      requiredPermission: 'admin',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const serviceRequestDefinitionIndexer: EntityIndexer = {
  objectType: 'service_request_definition',
  sourceEvents: [
    'SERVICE_REQUEST_DEFINITION_CREATED',
    'SERVICE_REQUEST_DEFINITION_UPDATED',
    'SERVICE_REQUEST_DEFINITION_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await createTenantScopedIndexerQuery<ServiceRequestDefinitionSearchRow>(knex, 'service_request_definitions', 'service_request_definitions', tenant)
      .select('definition_id', 'name', 'description', 'created_at', 'updated_at')
      .andWhere('definition_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = createTenantScopedIndexerQuery<ServiceRequestDefinitionSearchRow>(knex, 'service_request_definitions', 'service_request_definitions', tenant)
      .select('definition_id', 'name', 'description', 'created_at', 'updated_at')
      .orderBy('definition_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('definition_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
