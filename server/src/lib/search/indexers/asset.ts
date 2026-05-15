import type { Knex } from 'knex';

import { flattenJsonbPayload } from '../normalize';
import type { EntityIndexer, SearchDoc } from '@alga-psa/types';

interface AssetSearchRow {
  asset_id: string;
  name: string;
  asset_tag: string | null;
  serial_number: string | null;
  location: string | null;
  attributes: unknown;
  client_id: string | null;
  created_at?: Date | string | null;
  updated_at?: Date | string | null;
}

function compactJoin(values: Array<string | null | undefined>): string | undefined {
  const joined = values.map((value) => value?.trim()).filter(Boolean).join(' | ');
  return joined || undefined;
}

function toSourceUpdatedAt(row: AssetSearchRow): Date {
  const value = row.updated_at ?? row.created_at;
  return value ? new Date(value) : new Date();
}

function toSearchDoc(tenant: string, row: AssetSearchRow): SearchDoc {
  const identifier = row.asset_tag ?? undefined;
  const body = compactJoin([row.location, flattenJsonbPayload(row.attributes)]);

  return {
    tenant,
    objectType: 'asset',
    objectId: row.asset_id,
    title: row.name,
    subtitle: compactJoin([row.asset_tag, row.serial_number]),
    body,
    url: `/msp/assets/${row.asset_id}`,
    metadata: identifier ? { identifier } : undefined,
    acl: {
      requiredPermission: 'asset:read',
      clientScopeId: row.client_id ?? undefined,
    },
    sourceUpdatedAt: toSourceUpdatedAt(row),
  };
}

export const assetIndexer: EntityIndexer = {
  objectType: 'asset',
  sourceEvents: ['ASSET_CREATED', 'ASSET_UPDATED', 'ASSET_DELETED', 'ASSET_ASSIGNED', 'ASSET_UNASSIGNED'],

  async loadOne(knex: Knex, tenant: string, id: string): Promise<SearchDoc | null> {
    const row = await knex<AssetSearchRow>('assets')
      .select('asset_id', 'name', 'asset_tag', 'serial_number', 'location', 'attributes', 'client_id', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .andWhere('asset_id', id)
      .first();

    return row ? toSearchDoc(tenant, row) : null;
  },

  async loadBatch(
    knex: Knex,
    tenant: string,
    cursor: string | null | undefined,
    limit: number,
  ): Promise<SearchDoc[]> {
    const query = knex<AssetSearchRow>('assets')
      .select('asset_id', 'name', 'asset_tag', 'serial_number', 'location', 'attributes', 'client_id', 'created_at', 'updated_at')
      .where('tenant', tenant)
      .orderBy('asset_id', 'asc')
      .limit(limit);

    if (cursor) {
      query.andWhere('asset_id', '>', cursor);
    }

    const rows = await query;
    return rows.map((row) => toSearchDoc(tenant, row));
  },
};
