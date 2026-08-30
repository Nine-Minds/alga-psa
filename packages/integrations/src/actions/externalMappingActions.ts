'use server';

import logger from '@alga-psa/core/logger';
import { auditLog, createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { withAuth } from '@alga-psa/auth';
import { Knex } from 'knex';
import { hasPermission } from '@alga-psa/auth/rbac';
import type { IUserWithRoles } from '@alga-psa/types';
import { publishWorkflowEvent } from '@alga-psa/event-bus/publishers';
import {
  buildExternalMappingChangedPublishParams,
  type TenantExternalEntityMappingRow,
} from '../lib/externalMappingWorkflowEvents';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError,
} from '@alga-psa/ui/lib/errorHandling';
import { getStoredQboCredentialsMap, QboClientService } from '../lib/qbo/qboClientService';
import { getStoredXeroConnections } from '../lib/xero/xeroClientService';

const MAPPING_CACHE_TTL_MS = 30_000;

type ExternalMappingActionError = ActionMessageError | ActionPermissionError;

class ExpectedExternalMappingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExpectedExternalMappingError';
  }
}

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
  sync_status?: 'synced' | 'pending' | 'error' | 'manual_link' | 'unlinked' | null;
  last_synced_at?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
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
  metadata?: Record<string, unknown> | null;
}

/**
 * Entity types the generic mapping UI may write. Invoice / payment / credit
 * mappings move money in the accounting system, so they are only created by
 * the vetted onboarding and reconciliation workflows — never from the browser.
 */
const CATALOG_ENTITY_TYPES = new Set([
  'service',
  'service_category',
  'tax_code',
  'payment_term',
  'client',
]);

/** Realms are meaningful for these providers and must name a connected realm. */
const REALM_BASED_INTEGRATION_TYPES = new Set(['quickbooks_online', 'xero']);

/** CSV providers export to a file, not a connected realm. */
const CSV_INTEGRATION_TYPES = new Set(['quickbooks_csv', 'xero_csv']);

const KNOWN_INTEGRATION_TYPES = new Set([
  ...REALM_BASED_INTEGRATION_TYPES,
  ...CSV_INTEGRATION_TYPES,
]);

const PAYMENT_TERM_IDS = new Set(['net_30', 'net_15', 'due_on_receipt']);

function cloneMapping(mapping: ExternalEntityMapping): ExternalEntityMapping {
  return {
    ...mapping,
    metadata:
      mapping.metadata && typeof mapping.metadata === 'object'
        ? { ...mapping.metadata }
        : mapping.metadata ?? null,
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
    params.externalEntityId ?? '*',
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
    expiresAt: Date.now() + MAPPING_CACHE_TTL_MS,
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

// ─── Server-side validation ──────────────────────────────────────────────────

/** Local entity must exist and belong to the current tenant. */
async function assertLocalEntityOwnership(
  trx: Knex.Transaction,
  tenant: string,
  entityType: string,
  entityId: string
): Promise<void> {
  const db = tenantDb(trx, tenant);

  switch (entityType) {
    case 'service': {
      const row = await db.table('service_catalog').where({ service_id: entityId }).first('service_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map service ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'service_category': {
      const row = await db.table('service_categories').where({ category_id: entityId }).first('category_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map service category ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'tax_code': {
      const row = await db.table('tax_regions').where({ region_code: entityId }).first('region_code');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map tax region ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    case 'payment_term': {
      if (!PAYMENT_TERM_IDS.has(entityId)) {
        throw new ExpectedExternalMappingError(
          `Cannot map payment term ${entityId}: unknown payment term.`
        );
      }
      return;
    }
    case 'client': {
      const row = await db.table('clients').where({ client_id: entityId }).first('client_id');
      if (!row) {
        throw new ExpectedExternalMappingError(
          `Cannot map client ${entityId}: it does not exist for this tenant.`
        );
      }
      return;
    }
    default:
      throw new ExpectedExternalMappingError(
        `Mapping entity type ${entityType} is not managed by the mapping screen.`
      );
  }
}

/**
 * The realm is server-validated rather than accepted verbatim: a realm-based
 * provider may only write against a connected realm, and CSV providers only
 * write realm-less rows.
 */
async function assertRealmAllowed(
  tenant: string,
  integrationType: string,
  realm: string | null | undefined
): Promise<void> {
  const normalizedRealm = realm && realm.trim() !== '' ? realm.trim() : null;

  if (CSV_INTEGRATION_TYPES.has(integrationType)) {
    if (normalizedRealm !== null) {
      throw new ExpectedExternalMappingError(
        `Provider ${integrationType} exports to a file, not a connected realm; a realm cannot be set.`
      );
    }
    return;
  }

  if (!REALM_BASED_INTEGRATION_TYPES.has(integrationType)) {
    throw new ExpectedExternalMappingError(
      `Unknown accounting provider ${integrationType}.`
    );
  }

  if (!normalizedRealm) {
    throw new ExpectedExternalMappingError(
      `Provider ${integrationType} requires a connected realm; none was provided.`
    );
  }

  if (integrationType === 'quickbooks_online') {
    const credentialsMap = await getStoredQboCredentialsMap(tenant);
    if (!(normalizedRealm in credentialsMap)) {
      throw new ExpectedExternalMappingError(
        `Realm ${normalizedRealm} is not a connected QuickBooks Online company for this tenant.`
      );
    }
    return;
  }

  if (integrationType === 'xero') {
    const connections = await getStoredXeroConnections(tenant);
    const isConnectionKey = Object.prototype.hasOwnProperty.call(connections, normalizedRealm);
    const isXeroTenant = Object.values(connections).some(
      (connection) => connection.xeroTenantId === normalizedRealm
    );
    if (!isConnectionKey && !isXeroTenant) {
      throw new ExpectedExternalMappingError(
        `Realm ${normalizedRealm} is not a connected Xero organisation for this tenant.`
      );
    }
    return;
  }
}

function assertCatalogEntityType(entityType: string): void {
  if (!CATALOG_ENTITY_TYPES.has(entityType)) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${entityType} is managed by the accounting sync workflow and cannot be edited here.`
    );
  }
}

function assertKnownIntegrationType(integrationType: string): void {
  if (!KNOWN_INTEGRATION_TYPES.has(integrationType)) {
    throw new ExpectedExternalMappingError(`Unknown accounting provider ${integrationType}.`);
  }
}

/** QBO entity type an external mapping of the given local entity type must name. */
const QBO_REMOTE_ENTITY_TYPE: Record<string, string> = {
  service: 'Item',
  service_category: 'Item',
  tax_code: 'TaxCode',
  payment_term: 'Term',
  client: 'Customer',
};

/**
 * Fail-closed remote check for a manually-linked QuickBooks mapping: the
 * external id must resolve to a live entity of the expected type in the
 * connected company, or the link is rejected. Xero catalog links are validated
 * by realm connection only — the mapping screen loads its external list live
 * from the connected org, and Xero catalog ids are codes (ItemCode, TaxType)
 * rather than record ids, so a uniform id read would be wrong for them.
 */
async function assertRemoteEntityExists(
  tenant: string,
  integrationType: string,
  algaEntityType: string,
  externalEntityId: string,
  realm: string
): Promise<void> {
  if (integrationType !== 'quickbooks_online') {
    return;
  }
  const remoteType = QBO_REMOTE_ENTITY_TYPE[algaEntityType];
  if (!remoteType) {
    throw new ExpectedExternalMappingError(
      `Mapping entity type ${algaEntityType} is not managed by the mapping screen.`
    );
  }

  const qboClient = await QboClientService.create(tenant, realm);
  const entity = await qboClient.read<unknown>(remoteType, externalEntityId);
  if (!entity) {
    throw new ExpectedExternalMappingError(
      `QuickBooks ${remoteType} ${externalEntityId} does not exist in the connected company.`
    );
  }
}

// ─── Audit ───────────────────────────────────────────────────────────────────

interface MappingAuditParams {
  tenant: string;
  userId?: string;
  operation: 'CREATE' | 'UPDATE' | 'UNLINK';
  mapping: ExternalEntityMapping;
  before?: ExternalEntityMapping | null;
  details?: Record<string, unknown>;
}

/**
 * Audit event for mapping create / retarget / unlink. Routes through the
 * codebase's shared auditLog helper (packages/db/src/lib/auditLog.ts) and never
 * carries OAuth tokens or raw provider payloads.
 */
async function writeMappingAudit(
  trx: Knex.Transaction,
  { tenant, userId, operation, mapping, before, details }: MappingAuditParams
): Promise<void> {
  // The auditLog helper reads app.current_tenant to stamp the row; make it
  // resolvable for the duration of this transaction.
  await trx.raw("SELECT set_config('app.current_tenant', ?, true)", [tenant]);
  const realm = mapping.external_realm_id ?? null;
  const changedData: Record<string, unknown> = {
    integration_type: mapping.integration_type,
    alga_entity_type: mapping.alga_entity_type,
    alga_entity_id: mapping.alga_entity_id,
    external_entity_id: mapping.external_entity_id,
    external_realm_id: realm,
    sync_status: mapping.sync_status ?? null,
  };

  if (operation === 'UPDATE' && before) {
    if (before.alga_entity_id !== mapping.alga_entity_id) {
      changedData.alga_entity_id = {
        from: before.alga_entity_id,
        to: mapping.alga_entity_id,
      };
    }
    if (before.external_entity_id !== mapping.external_entity_id) {
      changedData.external_entity_id = {
        from: before.external_entity_id,
        to: mapping.external_entity_id,
      };
    }
  }

  const auditDetails: Record<string, unknown> = {
    actor_type: userId ? 'USER' : 'SYSTEM',
    provider: mapping.integration_type,
    entity_type: mapping.alga_entity_type,
    alga_entity_id: mapping.alga_entity_id,
    external_entity_id: mapping.external_entity_id,
    realm,
    ...(before ? { previous_external_entity_id: before.external_entity_id } : {}),
    ...(before ? { previous_alga_entity_id: before.alga_entity_id } : {}),
    ...(details ?? {}),
  };

  await auditLog(trx, {
    userId,
    operation,
    tableName: 'tenant_external_entity_mappings',
    recordId: mapping.id,
    changedData,
    details: auditDetails,
  });
}

// ─── Read ────────────────────────────────────────────────────────────────────

export const getExternalEntityMappings = withAuth(async (
  user,
  { tenant },
  params: GetMappingsParams
): Promise<ExternalEntityMapping[] | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'billing_settings', 'read', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to view accounting mappings.',
      'msp/integrations:errors.mappings.viewPermission'
    );
  }

  const cacheKey = buildCacheKey(tenant, params);
  const cached = getCachedMappings(cacheKey);
  if (cached) {
    logger.debug('External mapping cache hit', { tenantId: tenant, params });
    return cached;
  }

  const { integrationType, algaEntityType, externalRealmId, algaEntityId, externalEntityId } = params;

  logger.debug('External mapping lookup requested', {
    tenantId: tenant,
    integrationType,
    algaEntityType,
    externalRealmId,
    algaEntityId,
    externalEntityId,
  });

  try {
    const mappings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = tenantDb(trx, tenant).table<ExternalEntityMapping>(
        'tenant_external_entity_mappings'
      );

      query.whereNull('deleted_at');

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
      tenantId: tenant,
      results: mappings.length,
    });

    setCachedMappings(cacheKey, mappings);
    return mappings.map(cloneMapping);
  } catch (error: unknown) {
    logger.error('Failed to retrieve external entity mappings', {
      tenantId: tenant,
      error,
    });
    return actionError(
      'Unable to load mapping data. Please try again.',
      'msp/integrations:errors.mappings.loadFailed'
    );
  }
});

// ─── Create ──────────────────────────────────────────────────────────────────

export const createExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingData: CreateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  const {
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id,
    sync_status,
    metadata,
  } = mappingData;

  if (!external_entity_id || !alga_entity_id) {
    return actionError('Alga entity and external entity ids are required to create a mapping.');
  }

  logger.info('Creating external mapping record', {
    tenantId: tenant,
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id,
  });

  try {
    // Provider, entity type, realm and sync state are validated server-side;
    // money-moving entity types are rejected here entirely.
    assertKnownIntegrationType(integration_type);
    assertCatalogEntityType(alga_entity_type);

    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      await assertRealmAllowed(tenant, integration_type, external_realm_id);
      await assertLocalEntityOwnership(trx, tenant, alga_entity_type, alga_entity_id);

      const normalizedRealm =
        external_realm_id && external_realm_id.trim() !== ''
          ? external_realm_id.trim()
          : null;

      if (normalizedRealm) {
        await assertRemoteEntityExists(
          tenant,
          integration_type,
          alga_entity_type,
          external_entity_id,
          normalizedRealm
        );
      }

      // Relink: an earlier unlink tombstones the row; creating the same mapping
      // again is the explicit relink choice, so restore the row in place.
      const tombstoned = await tenantDb(trx, tenant)
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({
          tenant,
          integration_type,
          alga_entity_type,
          alga_entity_id,
        })
        .whereNotNull('deleted_at')
        .first();

      if (tombstoned) {
        const patch: Partial<ExternalEntityMapping> = {
          external_entity_id,
          external_realm_id: normalizedRealm,
          sync_status: sync_status ?? 'manual_link',
          metadata: metadata ?? null,
          deleted_at: null,
          updated_at: new Date().toISOString(),
        };
        const [relinked] = await tenantDb(trx, tenant)
          .table<ExternalEntityMapping>('tenant_external_entity_mappings')
          .where({ id: tombstoned.id })
          .update(patch)
          .returning('*');
        if (!relinked) {
          throw new ExpectedExternalMappingError('Unable to relink mapping. Please try again.');
        }

        // Re-creating the same mapping after an unlink is the explicit relink
        // choice, so it is audited as a CREATE with the tombstone as the
        // before-state.
        await writeMappingAudit(trx, {
          tenant,
          userId: user?.user_id,
          operation: 'CREATE',
          mapping: relinked,
          before: tombstoned,
          details: { relinked: true },
        });

        return { newMapping: relinked, relinkedFrom: tombstoned };
      }

      const [newMapping] = await tenantDb(trx, tenant)
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          tenant,
          integration_type,
          alga_entity_type,
          alga_entity_id,
          external_entity_id,
          external_realm_id: normalizedRealm,
          sync_status: sync_status ?? 'pending',
          metadata: metadata ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .returning('*');

      if (!newMapping) {
        throw new ExpectedExternalMappingError('Unable to save mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'CREATE',
        mapping: newMapping,
      });

      return { newMapping, relinkedFrom: null };
    });

    const { newMapping, relinkedFrom } = result;

    logger.info('External mapping created', {
      tenantId: tenant,
      mappingId: newMapping.id,
      relinked: Boolean(relinkedFrom),
    });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = newMapping.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      after: newMapping as unknown as TenantExternalEntityMappingRow,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);
    return cloneMapping(newMapping);
  } catch (error: any) {
    logger.error('Failed to create external entity mapping', {
      tenantId: tenant,
      integration_type,
      alga_entity_type,
      alga_entity_id,
      external_entity_id,
      external_realm_id,
      error,
    });

    if (error?.code === '23505') {
      return actionError(
        'A mapping already exists for this entity. Edit the existing mapping instead.',
        'msp/integrations:errors.mappings.duplicate'
      );
    }

    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }

    return actionError(
      'Unable to save mapping. Please try again.',
      'msp/integrations:errors.mappings.saveFailed'
    );
  }
});

// ─── Update ──────────────────────────────────────────────────────────────────

export const updateExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  updates: UpdateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for update.', 'msp/integrations:errors.mappings.idRequiredForUpdate');
  }
  if (Object.keys(updates).length === 0) {
    return actionError('No update data provided.', 'msp/integrations:errors.mappings.noUpdateData');
  }

  logger.info('Updating external mapping', {
    tenantId: tenant,
    mappingId,
    hasMetadata: updates.metadata !== undefined,
    hasExternalEntityIdUpdate: updates.external_entity_id !== undefined,
  });

  try {
    const result = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const before = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      if (!before) {
        throw new ExpectedExternalMappingError('Mapping not found. Refresh mappings and try again.');
      }
      if (before.deleted_at) {
        throw new ExpectedExternalMappingError(
          'Mapping is unlinked. Create it again to relink the entity.'
        );
      }

      // Money-moving and realm/provider/type fields are not editable here —
      // they belong to the vetted sync workflow.
      assertCatalogEntityType(before.alga_entity_type);
      assertKnownIntegrationType(before.integration_type);

      const updatePayload: Partial<ExternalEntityMapping> = {};
      if (updates.external_entity_id !== undefined) {
        if (!updates.external_entity_id) {
          throw new ExpectedExternalMappingError('External entity id is required.');
        }
        if (before.external_realm_id) {
          await assertRemoteEntityExists(
            tenant,
            before.integration_type,
            before.alga_entity_type,
            updates.external_entity_id,
            before.external_realm_id
          );
        }
        updatePayload.external_entity_id = updates.external_entity_id;
      }
      if (updates.metadata !== undefined) {
        updatePayload.metadata = updates.metadata ?? null;
      }
      if (updates.alga_entity_id !== undefined) {
        if (!updates.alga_entity_id) {
          throw new ExpectedExternalMappingError('Alga entity id is required.');
        }
        await assertLocalEntityOwnership(trx, tenant, before.alga_entity_type, updates.alga_entity_id);
        updatePayload.alga_entity_id = updates.alga_entity_id;
      }
      updatePayload.updated_at = new Date().toISOString();

      const [after] = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .update(updatePayload)
        .returning('*');

      if (!after) {
        throw new ExpectedExternalMappingError('Unable to update mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'UPDATE',
        mapping: after,
        before,
      });

      return { before, after };
    });

    const { before, after } = result;

    logger.info('External mapping updated', {
      tenantId: tenant,
      mappingId: after.id,
    });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = after.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: before as unknown as TenantExternalEntityMappingRow,
      after: after as unknown as TenantExternalEntityMappingRow,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);
    return cloneMapping(after);
  } catch (error: unknown) {
    logger.error('Failed to update external mapping', {
      tenantId: tenant,
      mappingId,
      error,
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    if ((error as { code?: string } | null)?.code === '23505') {
      return actionError(
        'A mapping already exists for this entity. Edit the existing mapping instead.',
        'msp/integrations:errors.mappings.duplicate'
      );
    }
    return actionError(
      'Unable to update mapping. Please try again.',
      'msp/integrations:errors.mappings.updateFailed'
    );
  }
});

// ─── Unlink (tombstone) ──────────────────────────────────────────────────────

export const deleteExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<{ success: true } | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'billing_settings', 'update', knex);
  if (!allowed) {
    return permissionError(
      'Permission denied: You do not have permission to manage accounting mappings.',
      'msp/integrations:errors.mappings.managePermission'
    );
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for deletion.', 'msp/integrations:errors.mappings.idRequiredForDelete');
  }

  logger.info('Unlinking external mapping', { tenantId: tenant, mappingId });

  try {
    const tombstoned = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const db = tenantDb(trx, tenant);
      const before = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      if (!before) {
        throw new ExpectedExternalMappingError('Mapping not found. Refresh mappings and try again.');
      }

      assertCatalogEntityType(before.alga_entity_type);

      if (before.deleted_at) {
        return { before, after: before };
      }

      const now = new Date().toISOString();
      const [after] = await db
        .table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .update({
          deleted_at: now,
          sync_status: 'unlinked',
          updated_at: now,
        })
        .returning('*');

      if (!after) {
        throw new ExpectedExternalMappingError('Unable to unlink mapping. Please try again.');
      }

      await writeMappingAudit(trx, {
        tenant,
        userId: user?.user_id,
        operation: 'UNLINK',
        mapping: after,
        before,
        details: { tombstoned: true },
      });

      return { before, after };
    });

    logger.info('External mapping unlinked', { tenantId: tenant, mappingId });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = tombstoned.after.updated_at ?? new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: tombstoned.before as unknown as TenantExternalEntityMappingRow,
      after: null,
      changedAt,
    });

    await publishWorkflowEvent({
      eventType: 'EXTERNAL_MAPPING_CHANGED',
      payload,
      ctx: { tenantId: tenant, occurredAt: changedAt, actor },
      idempotencyKey,
    });

    invalidateTenantMappingCache(tenant);
    return { success: true };
  } catch (error: unknown) {
    logger.error('Failed to unlink external entity mapping', {
      tenantId: tenant,
      mappingId,
      error,
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    return actionError(
      'Unable to delete mapping. Please try again.',
      'msp/integrations:errors.mappings.deleteFailed'
    );
  }
});
