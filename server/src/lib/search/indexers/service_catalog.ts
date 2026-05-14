import type { Knex } from 'knex';

import { flattenJsonbPayload } from '../normalize';
import type { EntityIndexer, SearchDoc } from '../types';

interface ServiceCatalogSearchRow {
  service_id: string;
  service_name: string;
  description: string | null;
  attributes: unknown;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: ServiceCatalogSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: ServiceCatalogSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'service_catalog',
    objectId: row.service_id,
    title: row.service_name,
    body: compactJoin([row.description, flattenJsonbPayload(row.attributes)]),
    url: `/msp/billing/services/${row.service_id}`,
    acl: {
      requiredPermission: 'service_catalog:read',
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const serviceCatalogIndexer: EntityIndexer = {
  objectType: 'service_catalog',
  sourceEvents: [],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<ServiceCatalogSearchRow>('service_catalog')
      .select('service_id', 'service_name', 'description', 'attributes', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('service_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<ServiceCatalogSearchRow>('service_catalog')
      .select('service_id', 'service_name', 'description', 'attributes', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('service_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('service_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
