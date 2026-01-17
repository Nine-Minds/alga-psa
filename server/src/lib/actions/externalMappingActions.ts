'use server';

import logger from '@alga-psa/core/logger';
import {
  getActionRegistry,
  type ActionParameterDefinition,
  type ActionExecutionContext
} from '@alga-psa/shared/workflow/core';
import { createTenantKnex } from 'server/src/lib/db';
import { withTransaction } from '@alga-psa/db';
import { getCurrentUser } from 'server/src/lib/actions/user-actions/userActions';
import { Knex } from 'knex';
import { hasPermission } from 'server/src/lib/auth/rbac';
import type { IUserWithRoles } from 'server/src/interfaces/auth.interfaces';

const MAPPING_CACHE_TTL_MS = 30_000;

type MappingCacheEntry = {
  value: ExternalEntityMapping[];
  expiresAt: number;
};

const mappingCache = new Map<string, MappingCacheEntry>();

export interface ExternalEntityMapping {
  id: string;
  tenant: string;
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface GetMappingsParams {
  integrationType?: string;
  algaEntityType?: string;
  externalRealmId?: string | null;
  algaEntityId?: string;
  externalEntityId?: string;
}

export interface CreateMappingData {
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_entity_id: string;
  external_realm_id?: string | null;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  metadata?: Record<string, unknown> | null;
}

export interface UpdateMappingData {
  alga_entity_id?: string;
  external_entity_id?: string;
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | null;
  metadata?: Record<string, unknown> | null;
  external_realm_id?: string | null;
}

function cloneMapping(mapping: ExternalEntityMapping): ExternalEntityMapping {
  return {
    ...mapping,
    metadata:
      mapping.metadata && typeof mapping.metadata === 'object'
        ? { ...mapping.metadata }
        : mapping.metadata ?? null
  };
}

function buildCacheKey(tenantId: string, params: GetMappingsParams): string {
  const realmSegment =
    params.externalRealmId === undefined
      ? '~'
      : params.externalRealmId === null || params.externalRealmId === ''
        ? 'null'
        : params.externalRealmId;

  return [
    tenantId,
    params.integrationType ?? '*',
    params.algaEntityType ?? '*',
    realmSegment,
    params.algaEntityId ?? '*',
    params.externalEntityId ?? '*'
  ].join('|');
}

function getCachedMappings(cacheKey: string): ExternalEntityMapping[] | null {
  const entry = mappingCache.get(cacheKey);
  if (!entry) {
    return null;
  }
  if (entry.expiresAt <= Date.now()) {
    mappingCache.delete(cacheKey);
    return null;
  }
  return entry.value.map(cloneMapping);
}

function setCachedMappings(cacheKey: string, mappings: ExternalEntityMapping[]): void {
  mappingCache.set(cacheKey, {
    value: mappings.map(cloneMapping),
    expiresAt: Date.now() + MAPPING_CACHE_TTL_MS
  });
}

function invalidateTenantMappingCache(tenantId: string): void {
  const prefix = `${tenantId}|`;
  for (const key of mappingCache.keys()) {
    if (key.startsWith(prefix)) {
      mappingCache.delete(key);
    }
  }
}

async function resolveTenantContext(): Promise<{
  tenantId: string;
  knex: Knex;
  user: IUserWithRoles;
}> {
  const user = await getCurrentUser();
  if (!user?.tenant) {
    throw new Error('User or Tenant ID not found. Unable to perform tenant-scoped operation.');
  }

  const { knex } = await createTenantKnex();
  return { tenantId: user.tenant, knex, user };
}

async function ensureBillingAccess(
  action: 'read' | 'update'
): Promise<{ tenantId: string; knex: Knex; user: IUserWithRoles }> {
  const context = await resolveTenantContext();
  const allowed = await hasPermission(context.user, 'billing_settings', action, context.knex);
  if (!allowed) {
    throw new Error(
      action === 'read'
        ? 'Forbidden: You do not have permission to view accounting mappings.'
        : 'Forbidden: You do not have permission to manage accounting mappings.'
    );
  }
  return context;
}

export async function getExternalEntityMappings(
  params: GetMappingsParams
): Promise<ExternalEntityMapping[]> {
  const { tenantId, knex } = await ensureBillingAccess('read');
  const cacheKey = buildCacheKey(tenantId, params);
  const cached = getCachedMappings(cacheKey);
  if (cached) {
    logger.debug('External mapping cache hit', { tenantId, params });
    return cached;
  }

  const { integrationType, algaEntityType, externalRealmId, algaEntityId, externalEntityId } = params;

  logger.debug('External mapping lookup requested', {
    tenantId,
    integrationType,
    algaEntityType,
    externalRealmId,
    algaEntityId,
    externalEntityId
  });

  try {
    const mappings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = trx<ExternalEntityMapping>('tenant_external_entity_mappings').where({
        tenant: tenantId
      });

      if (integrationType) {
        query.andWhere({ integration_type: integrationType });
      }
      if (algaEntityType) {
        query.andWhere({ alga_entity_type: algaEntityType });
      }
      if (algaEntityId) {
        query.andWhere({ alga_entity_id: algaEntityId });
      }
      if (externalEntityId) {
        query.andWhere({ external_entity_id: externalEntityId });
      }

      if (externalRealmId !== undefined) {
        if (externalRealmId === null || externalRealmId === '') {
          query.andWhere(function () {
            this.whereNull('external_realm_id').orWhere('external_realm_id', '');
          });
        } else {
          query.andWhere({ external_realm_id: externalRealmId });
        }
      }

      return await query.select('*').orderBy('updated_at', 'desc');
    });

    logger.debug('External mapping lookup completed', {
      tenantId,
      results: mappings.length
    });

    setCachedMappings(cacheKey, mappings);
    return mappings.map(cloneMapping);
  } catch (error: unknown) {
    logger.error('Failed to retrieve external entity mappings', {
      tenantId,
      error
    });
    throw new Error('Unable to load mapping data. Please try again.');
  }
}

export async function createExternalEntityMapping(
  mappingData: CreateMappingData
): Promise<ExternalEntityMapping> {
  const { tenantId, knex } = await ensureBillingAccess('update');
  const {
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id,
    sync_status,
    metadata
  } = mappingData;

  logger.info('Creating external mapping record', {
    tenantId,
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id
  });

  try {
    const [newMapping] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          tenant: tenantId,
          integration_type,
          alga_entity_type,
          alga_entity_id,
          external_entity_id,
          external_realm_id: external_realm_id ?? null,
          sync_status: sync_status ?? 'pending',
          metadata: metadata ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .returning('*');
    });

    if (!newMapping) {
      throw new Error('Failed to create mapping, insert operation did not return the new record.');
    }

    logger.info('External mapping created', {
      tenantId,
      mappingId: newMapping.id
    });

    invalidateTenantMappingCache(tenantId);
    return cloneMapping(newMapping);
  } catch (error: any) {
    logger.error('Failed to create external entity mapping', {
      tenantId,
      integration_type,
      alga_entity_type,
      alga_entity_id,
      external_entity_id,
      external_realm_id,
      error
    });

    if (error?.code === '23505') {
      throw new Error(
        'A mapping already exists for this entity. Edit the existing mapping instead.'
      );
    }

    throw new Error('Unable to save mapping. Please try again.');
  }
}

export async function updateExternalEntityMapping(
  mappingId: string,
  updates: UpdateMappingData
): Promise<ExternalEntityMapping> {
  const { tenantId, knex } = await ensureBillingAccess('update');

  if (!mappingId) {
    throw new Error('Mapping ID is required for update.');
  }
  if (Object.keys(updates).length === 0) {
    throw new Error('No update data provided.');
  }

  logger.info('Updating external mapping', {
    tenantId,
    mappingId,
    hasMetadata: updates.metadata !== undefined,
    hasExternalEntityIdUpdate: updates.external_entity_id !== undefined
  });

  const updatePayload: Partial<ExternalEntityMapping> = { ...updates };
  if (updatePayload.metadata !== undefined) {
    updatePayload.metadata = updatePayload.metadata ?? null;
  }
  updatePayload.updated_at = new Date().toISOString();

  try {
    const [updatedMapping] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          id: mappingId,
          tenant: tenantId
        })
        .update(updatePayload)
        .returning('*');
    });

    if (!updatedMapping) {
      const exists = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
          .select('id')
          .where({ id: mappingId, tenant: tenantId })
          .first();
      });

      if (!exists) {
        throw new Error(
          `Mapping with ID ${mappingId} not found for the current tenant (${tenantId}).`
        );
      }

      throw new Error(
        `Failed to update mapping ID ${mappingId}. Record exists but update failed.`
      );
    }

    logger.info('External mapping updated', {
      tenantId,
      mappingId: updatedMapping.id
    });

    invalidateTenantMappingCache(tenantId);
    return cloneMapping(updatedMapping);
  } catch (error: unknown) {
    logger.error('Failed to update external mapping', {
      tenantId,
      mappingId,
      error
    });
    throw new Error('Unable to update mapping. Please try again.');
  }
}

export async function deleteExternalEntityMapping(mappingId: string): Promise<void> {
  const { tenantId, knex } = await ensureBillingAccess('update');

  if (!mappingId) {
    throw new Error('Mapping ID is required for deletion.');
  }

  logger.info('Deleting external mapping', { tenantId, mappingId });

  try {
    const deletedCount = await withTransaction(knex, async (trx: Knex.Transaction) => {
      return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          id: mappingId,
          tenant: tenantId
        })
        .del();
    });

    if (deletedCount === 0) {
      const exists = await withTransaction(knex, async (trx: Knex.Transaction) => {
        return await trx<ExternalEntityMapping>('tenant_external_entity_mappings')
          .select('id')
          .where({ id: mappingId, tenant: tenantId })
          .first();
      });

      if (!exists) {
        logger.warn('External mapping delete requested for unknown id', {
          tenantId,
          mappingId
        });
        return;
      }

      throw new Error(
        `Failed to delete mapping ID ${mappingId}. Record exists but deletion failed.`
      );
    }

    logger.info('External mapping deleted', { tenantId, mappingId });
    invalidateTenantMappingCache(tenantId);
  } catch (error: unknown) {
    logger.error('Failed to delete external entity mapping', {
      tenantId,
      mappingId,
      error
    });
    throw new Error('Unable to delete mapping. Please try again.');
  }
}

interface LookupExternalEntityIdParams {
  integration_type: string;
  alga_entity_type: string;
  alga_entity_id: string;
  external_realm_id?: string;
}

const lookupExternalEntityIdParamsDef: ActionParameterDefinition[] = [
  {
    name: 'integration_type',
    type: 'string',
    required: true,
    description: 'Identifier for the external system (e.g., quickbooks_online)'
  },
  {
    name: 'alga_entity_type',
    type: 'string',
    required: true,
    description: 'Type of the entity within the Alga system (e.g., item, tax_code, term)'
  },
  {
    name: 'alga_entity_id',
    type: 'string',
    required: true,
    description: 'The unique identifier of the entity within the Alga system'
  },
  {
    name: 'external_realm_id',
    type: 'string',
    required: false,
    description: 'QuickBooks realm or other external context identifier'
  }
];

async function lookupExternalEntityIdAction(
  params: Record<string, unknown>,
  context: ActionExecutionContext
): Promise<{ external_entity_id: string | null }> {
  const { integration_type, alga_entity_type, alga_entity_id, external_realm_id } =
    params as unknown as LookupExternalEntityIdParams;
  const { tenant } = context;

  if (!tenant) {
    throw new Error('Tenant ID not found in action execution context.');
  }

  logger.debug('External workflow mapping lookup requested', {
    tenant,
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_realm_id
  });

  try {
    const { knex } = await createTenantKnex();

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = trx('tenant_external_entity_mappings')
        .select('external_entity_id')
        .where({
          tenant,
          integration_type,
          alga_entity_type,
          alga_entity_id
        })
        .first();

      if (external_realm_id) {
        query.andWhere('external_realm_id', external_realm_id);
      } else {
        query.andWhere(function () {
          this.whereNull('external_realm_id').orWhere('external_realm_id', '');
        });
      }

      return await query;
    });

    const externalId = result?.external_entity_id ?? null;

    if (externalId) {
      logger.debug('External workflow mapping lookup succeeded', {
        tenant,
        integration_type,
        alga_entity_type,
        alga_entity_id,
        external_realm_id,
        externalId
      });
    } else {
      logger.warn('External workflow mapping lookup returned no result', {
        tenant,
        integration_type,
        alga_entity_type,
        alga_entity_id,
        external_realm_id
      });
    }

    return { external_entity_id: externalId };
  } catch (error: unknown) {
    logger.error('External workflow mapping lookup failed', {
      tenant,
      integration_type,
      alga_entity_type,
      alga_entity_id,
      external_realm_id,
      error
    });
    throw error;
  }
}

async function performActionRegistration() {
  try {
    const registry = getActionRegistry();

    registry.registerSimpleAction(
      'external:lookupEntityId',
      'Looks up an external entity ID from an Alga entity ID using the generic mapping table',
      lookupExternalEntityIdParamsDef,
      lookupExternalEntityIdAction
    );
    logger.debug('External mapping workflow action registered');
  } catch (error) {
    logger.error('Failed to register external mapping workflow action', { error });
  }
}

void performActionRegistration();
