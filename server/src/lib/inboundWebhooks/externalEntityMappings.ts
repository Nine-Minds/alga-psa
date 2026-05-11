import type { Knex } from 'knex';
import { createTenantKnex } from '@alga-psa/db';

export interface TenantExternalEntityMapping {
  id: string;
  tenant_id: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id: string | null;
  sync_status: string | null;
  last_synced_at: Date | string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface LookupAlgaEntityByExternalIdResult {
  algaEntityId: string;
  mapping: TenantExternalEntityMapping;
}

export interface ExternalEntityMappingLookupOptions {
  externalRealmId?: string | null;
  knex?: Knex;
}

export async function lookupAlgaEntityByExternalId(
  tenant: string,
  webhookSlug: string,
  entityType: string,
  externalId: string,
  options: ExternalEntityMappingLookupOptions = {},
): Promise<LookupAlgaEntityByExternalIdResult | null> {
  const db = options.knex ?? (await createTenantKnex(tenant)).knex;
  const query = db<TenantExternalEntityMapping>('tenant_external_entity_mappings')
    .where({
      tenant_id: tenant,
      integration_type: webhookSlug,
      alga_entity_type: entityType,
      external_entity_id: externalId,
    })
    .orderByRaw('external_realm_id IS NOT NULL ASC')
    .orderBy('updated_at', 'desc');

  if (options.externalRealmId !== undefined) {
    if (options.externalRealmId === null || options.externalRealmId === '') {
      query.whereNull('external_realm_id');
    } else {
      query.andWhere('external_realm_id', options.externalRealmId);
    }
  }

  const mapping = await query.first();

  return mapping
    ? {
        algaEntityId: mapping.alga_entity_id,
        mapping,
      }
    : null;
}
