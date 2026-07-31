import type { Knex } from 'knex';

import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface StockUnitSearchRow {
  unit_id: string;
  service_id: string;
  service_name: string | null;
  sku: string | null;
  serial_number: string | null;
  mac_address: string | null;
  status: string;
  client_id: string | null;
  location_id: string | null;
  location_name: string | null;
  received_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: StockUnitSearchRow): Date {
  const value = row.updated_at ?? row.received_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: StockUnitSearchRow): SearchDoc {
  const title = row.serial_number ?? row.mac_address ?? row.service_name ?? row.unit_id;

  return {
    tenant,
    objectType: 'stock_unit',
    objectId: row.unit_id,
    title,
    subtitle: compactJoin([row.service_name, row.sku, row.status]),
    body: compactJoin([row.serial_number, row.mac_address, row.service_name, row.sku, row.location_name, row.status]),
    url: `/msp/inventory/units?unitId=${row.unit_id}`,
    metadata: {
      serviceId: row.service_id,
      sku: row.sku,
      serialNumber: row.serial_number,
      macAddress: row.mac_address,
      status: row.status,
      locationId: row.location_id,
    },
    acl: {
      requiredPermission: 'inventory:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const stockUnitIndexer: EntityIndexer = {
  objectType: 'stock_unit',
  sourceEvents: [
    'INVENTORY_STOCK_UNIT_CREATED',
    'INVENTORY_STOCK_UNIT_UPDATED',
    'INVENTORY_STOCK_UNIT_DELETED',
  ],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<StockUnitSearchRow>('stock_units as su')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'su.service_id').andOn('sc.tenant', '=', 'su.tenant');
      })
      .leftJoin('stock_locations as loc', function () {
        this.on('loc.location_id', '=', 'su.location_id').andOn('loc.tenant', '=', 'su.tenant');
      })
      .where({ 'su.tenant': tenant, 'su.unit_id': id })
      .select(
        'su.unit_id',
        'su.service_id',
        'su.serial_number',
        'su.mac_address',
        'su.status',
        'su.client_id',
        'su.location_id',
        'su.received_at',
        'su.updated_at',
        'sc.service_name',
        'sc.sku',
        'loc.name as location_name',
      )
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<StockUnitSearchRow>('stock_units as su')
      .leftJoin('service_catalog as sc', function () {
        this.on('sc.service_id', '=', 'su.service_id').andOn('sc.tenant', '=', 'su.tenant');
      })
      .leftJoin('stock_locations as loc', function () {
        this.on('loc.location_id', '=', 'su.location_id').andOn('loc.tenant', '=', 'su.tenant');
      })
      .where({ 'su.tenant': tenant })
      .select(
        'su.unit_id',
        'su.service_id',
        'su.serial_number',
        'su.mac_address',
        'su.status',
        'su.client_id',
        'su.location_id',
        'su.received_at',
        'su.updated_at',
        'sc.service_name',
        'sc.sku',
        'loc.name as location_name',
      )
      .orderBy('su.unit_id', 'asc')
      .limit(limit);

    if (cursor) query.andWhere('su.unit_id', '>', cursor);

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
