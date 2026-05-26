import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface ServiceCatalogSearchRow {
  service_id: string;
  service_name: string;
  description: string | null;
  sku: string | null;
  vendor: string | null;
  manufacturer: string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSearchDoc(tenant: string, row: ServiceCatalogSearchRow): SearchDoc {
  return {
    tenant,
    objectType: 'service_catalog',
    objectId: row.service_id,
    title: row.service_name,
    body: compactJoin([row.description, row.sku, row.vendor, row.manufacturer]),
    url: `/msp/billing/services/${row.service_id}`,
    acl: {
      requiredPermission: 'service_catalog:read',
    },
    sourceUpdatedAt: new Date(),
  };
}

export const serviceCatalogIndexer: EntityIndexer = {
  objectType: 'service_catalog',
  sourceEvents: ['SERVICE_CATALOG_CREATED', 'SERVICE_CATALOG_UPDATED', 'SERVICE_CATALOG_DELETED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<ServiceCatalogSearchRow>('service_catalog')
      .select('service_id', 'service_name', 'description', 'sku', 'vendor', 'manufacturer')
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
      .select('service_id', 'service_name', 'description', 'sku', 'vendor', 'manufacturer')
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
