import type { Knex } from 'knex';
import { createTenantKnex, tenantDb } from '@alga-psa/db';

export interface TenantExternalEntityMapping {
  id: string;
  tenant: string;
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

export interface WriteEntityMappingOptions {
  externalRealmId?: string | null;
  metadata?: Record<string, unknown> | null;
  knex?: Knex;
}

export async function lookupAlgaEntityByExternalId(
  tenant: string,
  webhookSlug: string,
  entityType: string,
  externalId: string,
  options: ExternalEntityMappingLookupOptions = {},
): Promise<LookupAlgaEntityByExternalIdResult | null> {
  const knex = options.knex ?? (await createTenantKnex(tenant)).knex;
  const db = tenantDb(knex, tenant);
  const query = db.table<TenantExternalEntityMapping>('tenant_external_entity_mappings')
    .where({
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

export async function writeEntityMapping(
  tenant: string,
  webhookSlug: string,
  entityType: string,
  algaId: string,
  externalId: string,
  options: WriteEntityMappingOptions = {},
): Promise<TenantExternalEntityMapping> {
  const knex = options.knex ?? (await createTenantKnex(tenant)).knex;
  const db = tenantDb(knex, tenant);
  const externalRealmId = options.externalRealmId || null;

  const existingExternalMapping = await db.table<TenantExternalEntityMapping>('tenant_external_entity_mappings')
    .where({
      integration_type: webhookSlug,
      external_entity_id: externalId,
    })
    .modify((query) => {
      if (externalRealmId === null) {
        query.whereNull('external_realm_id');
      } else {
        query.andWhere('external_realm_id', externalRealmId);
      }
    })
    .first();

  if (existingExternalMapping && existingExternalMapping.alga_entity_id !== algaId) {
    throw new Error(
      `External ${entityType} id "${externalId}" is already mapped to ${existingExternalMapping.alga_entity_id}`,
    );
  }

  const [mapping] = await db.table<TenantExternalEntityMapping>('tenant_external_entity_mappings')
    .insert({
      tenant,
      integration_type: webhookSlug,
      alga_entity_type: entityType,
      alga_entity_id: algaId,
      external_entity_id: externalId,
      external_realm_id: externalRealmId,
      sync_status: 'synced',
      last_synced_at: knex.fn.now(),
      metadata: options.metadata ?? null,
    })
    .onConflict(['tenant', 'integration_type', 'alga_entity_type', 'alga_entity_id'])
    .merge({
      external_entity_id: externalId,
      external_realm_id: externalRealmId,
      sync_status: 'synced',
      last_synced_at: new Date().toISOString(),
      metadata: options.metadata ?? null,
      updated_at: new Date().toISOString(),
    })
    .returning('*');

  return mapping;
}
