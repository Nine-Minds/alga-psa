'use server';

import logger from '@alga-psa/core/logger';
import {
  createTenantKnex,
  tenantDb,
  withTransaction,
  writeAccountingAudit,
  lockInvoiceForExternalSync,
  lockInvoicesForExternalSync,
  ACCOUNTING_EXPORT_INVOICE_CANCELLED,
  ACCOUNTING_EXPORT_INVOICE_NOT_FOUND,
} from '@alga-psa/db';
import type { AccountingAuditProvider } from '@alga-psa/db';
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

export const getExternalEntityMappings = withAuth(async (
  user,
  { tenant },
  params: GetMappingsParams
): Promise<ExternalEntityMapping[] | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'catalog_read', knex);
  if (!allowed) {
    return permissionError('Permission denied: You do not have permission to view accounting mappings.', 'msp/integrations:errors.mappings.viewPermission');
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
    externalEntityId
  });

  try {
    const mappings = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const query = tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings');

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
      results: mappings.length
    });

    setCachedMappings(cacheKey, mappings);
    return mappings.map(cloneMapping);
  } catch (error: unknown) {
    logger.error('Failed to retrieve external entity mappings', {
      tenantId: tenant,
      error
    });
    return actionError('Unable to load mapping data. Please try again.', 'msp/integrations:errors.mappings.loadFailed');
  }
});

export const createExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingData: CreateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError('Permission denied: You do not have permission to manage accounting mappings.', 'msp/integrations:errors.mappings.managePermission');
  }


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
    tenantId: tenant,
    integration_type,
    alga_entity_type,
    alga_entity_id,
    external_entity_id,
    external_realm_id
  });

  try {
    const [newMapping] = await withTransaction(knex, async (trx: Knex.Transaction) => {
      // Invoice-typed mappings must serialize against invoice void on the
      // shared invoice row lock (packages/db/src/lib/invoiceExternalSyncLock.ts):
      // the void transaction's first statement is a FOR UPDATE on the invoice
      // row, so this insert either commits before the void re-reads the mapping
      // (the void then treats the invoice as remote-affecting) or blocks until
      // the void commits and is refused on the now-cancelled invoice — a
      // cancelled local invoice can never gain a mapping to a live remote
      // document. The same lock refuses invoices already cancelled. Only the
      // invoice entity type touches the remote ledger this way; service/client/
      // other mappings link no invoice and need no lock.
      if (alga_entity_type === 'invoice') {
        await lockInvoiceForExternalSync(trx, tenant, alga_entity_id);
      }

      return await tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .insert({
          id: trx.raw('gen_random_uuid()'),
          tenant,
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
      throw new ExpectedExternalMappingError('Unable to save mapping. Please try again.');
    }

    logger.info('External mapping created', {
      tenantId: tenant,
      mappingId: newMapping.id
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

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_created', {
      userId: user.user_id,
      provider: integration_type as AccountingAuditProvider,
      recordId: newMapping.id,
      details: {
        alga_entity_type,
        alga_entity_id,
        external_entity_id,
        external_realm_id,
      },
    }).catch((error) => {
      logger.warn('Failed to write mapping-created audit entry', { tenantId: tenant, error });
    });

    return cloneMapping(newMapping);
  } catch (error: any) {
    logger.error('Failed to create external entity mapping', {
      tenantId: tenant,
      integration_type,
      alga_entity_type,
      alga_entity_id,
      external_entity_id,
      external_realm_id,
      error
    });

    if (error?.code === '23505') {
      return actionError(
        'A mapping already exists for this entity. Edit the existing mapping instead.'
      , 'msp/integrations:errors.mappings.duplicate');
    }

    // The invoice guard inside the transaction refuses with a business-rule
    // code (cancelled invoice, or the invoice row disappeared). Surface it as
    // the same local-state reason rather than a generic save failure — nothing
    // here confirms whether any remote entity exists.
    if (error?.code === ACCOUNTING_EXPORT_INVOICE_CANCELLED) {
      return actionError(
        'The invoice has been voided and cannot be mapped to the accounting integration.'
      , 'msp/integrations:errors.mappings.invoiceCancelled');
    }
    if (error?.code === ACCOUNTING_EXPORT_INVOICE_NOT_FOUND) {
      return actionError(
        'The invoice no longer exists and cannot be mapped to the accounting integration.'
      , 'msp/integrations:errors.mappings.invoiceNotFound');
    }

    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }

    return actionError('Unable to save mapping. Please try again.', 'msp/integrations:errors.mappings.saveFailed');
  }
});

export const updateExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string,
  updates: UpdateMappingData
): Promise<ExternalEntityMapping | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError('Permission denied: You do not have permission to manage accounting mappings.', 'msp/integrations:errors.mappings.managePermission');
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for update.', 'msp/integrations:errors.mappings.idRequiredForUpdate');
  }

  // Build the update by explicitly picking the fields UpdateMappingData
  // declares. Never spread the caller's object into the write: a direct
  // server-action call can otherwise smuggle alga_entity_type, tenant, id, or
  // integration_type past the TypeScript constraint — which would let a
  // non-invoice row be converted into an invoice-typed mapping (or the row's
  // identity be rewritten) with no invoice lock and no cancelled check.
  // Dropping unknown keys is deliberate, so the invoice-lock guard below keys
  // on the row's real, persisted type. A payload that only carried forbidden
  // keys has nothing editable to do and is refused like an empty payload.
  const updatePayload: Partial<ExternalEntityMapping> = {};
  if (updates.alga_entity_id !== undefined) updatePayload.alga_entity_id = updates.alga_entity_id;
  if (updates.external_entity_id !== undefined) updatePayload.external_entity_id = updates.external_entity_id;
  if (updates.sync_status !== undefined) updatePayload.sync_status = updates.sync_status;
  if (updates.external_realm_id !== undefined) updatePayload.external_realm_id = updates.external_realm_id;
  if (updates.metadata !== undefined) updatePayload.metadata = updates.metadata ?? null;

  if (Object.keys(updatePayload).length === 0) {
    return actionError('No update data provided.', 'msp/integrations:errors.mappings.noUpdateData');
  }
  updatePayload.updated_at = new Date().toISOString();

  logger.info('Updating external mapping', {
    tenantId: tenant,
    mappingId,
    hasMetadata: updates.metadata !== undefined,
    hasExternalEntityIdUpdate: updates.external_entity_id !== undefined
  });

  try {
    const { before, after } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const before = await tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      // An invoice-typed mapping row write retargets which remote document (or
      // which local invoice) it links — the same remote-affecting state change
      // as a fresh insert, so it must hold the shared invoice row lock and
      // refuse cancelled invoices before the update commits (see
      // lockInvoiceForExternalSync). When the update repoints which invoice is
      // mapped, both the old and the new invoice are involved; multi-lock
      // acquisition is sorted to match the deadlock-avoidance convention.
      // Non-invoice mappings (service/client/…) link no invoice and need no
      // lock. A row's type cannot become invoice through an update:
      // alga_entity_type is not an editable field, and the action drops unknown
      // keys from a runtime payload before writing, so a service row can never
      // be converted into an invoice-typed mapping that would need this lock
      // and the cancelled check.
      if (before?.alga_entity_type === 'invoice') {
        const targetInvoiceId = updates.alga_entity_id ?? before.alga_entity_id;
        const involvedInvoiceIds =
          targetInvoiceId === before.alga_entity_id
            ? [before.alga_entity_id]
            : [before.alga_entity_id, targetInvoiceId];
        await lockInvoicesForExternalSync(trx, tenant, involvedInvoiceIds);
      }

      const [after] = await tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .update(updatePayload)
        .returning('*');

      return { before: before ?? null, after: after ?? null };
    });

    if (!after) {
      if (!before) {
        throw new ExpectedExternalMappingError('Mapping not found. Refresh mappings and try again.');
      }

      throw new ExpectedExternalMappingError('Unable to update mapping. Please try again.');
    }

    logger.info('External mapping updated', {
      tenantId: tenant,
      mappingId: after.id
    });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = after.updated_at ?? updatePayload.updated_at;
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: before as unknown as TenantExternalEntityMappingRow | null,
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

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_updated', {
      userId: user.user_id,
      provider: after.integration_type as AccountingAuditProvider,
      recordId: after.id,
      details: {
        before: {
          alga_entity_id: before?.alga_entity_id ?? null,
          external_entity_id: before?.external_entity_id ?? null,
          sync_status: before?.sync_status ?? null,
          external_realm_id: before?.external_realm_id ?? null,
        },
        after: {
          alga_entity_id: after.alga_entity_id,
          external_entity_id: after.external_entity_id,
          sync_status: after.sync_status ?? null,
          external_realm_id: after.external_realm_id ?? null,
        },
      },
    }).catch((error) => {
      logger.warn('Failed to write mapping-updated audit entry', { tenantId: tenant, error });
    });

    return cloneMapping(after);
  } catch (error: unknown) {
    logger.error('Failed to update external mapping', {
      tenantId: tenant,
      mappingId,
      error
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    const updateError = error as { code?: string } | null;
    if (updateError?.code === '23505') {
      return actionError('A mapping already exists for this entity. Edit the existing mapping instead.', 'msp/integrations:errors.mappings.duplicate');
    }
    if (updateError?.code === ACCOUNTING_EXPORT_INVOICE_CANCELLED) {
      return actionError('The invoice has been voided and cannot be mapped to the accounting integration.', 'msp/integrations:errors.mappings.invoiceCancelled');
    }
    if (updateError?.code === ACCOUNTING_EXPORT_INVOICE_NOT_FOUND) {
      return actionError('The invoice no longer exists and cannot be mapped to the accounting integration.', 'msp/integrations:errors.mappings.invoiceNotFound');
    }
    return actionError('Unable to update mapping. Please try again.', 'msp/integrations:errors.mappings.updateFailed');
  }
});

export const deleteExternalEntityMapping = withAuth(async (
  user,
  { tenant },
  mappingId: string
): Promise<{ success: true } | ExternalMappingActionError> => {
  const { knex } = await createTenantKnex();
  const allowed = await hasPermission(user, 'accounting_integrations', 'mappings_manage', knex);
  if (!allowed) {
    return permissionError('Permission denied: You do not have permission to manage accounting mappings.', 'msp/integrations:errors.mappings.managePermission');
  }

  if (!mappingId) {
    return actionError('Mapping ID is required for deletion.', 'msp/integrations:errors.mappings.idRequiredForDelete');
  }

  logger.info('Deleting external mapping', { tenantId: tenant, mappingId });

  // Deletion deliberately does NOT take the invoice row lock that invoice
  // mapping creation/update must hold. The invariant guarded by that lock is
  // that a cancelled invoice can never GAIN a remote link after the void
  // decided no remote void is needed; removing a link cannot create that state.
  // The void's remote-affecting decision is made under the invoice lock against
  // the mapping as it then exists, and the post-commit enqueue re-reads the
  // mapping (syncProducers.enqueueInvoiceVoid) and simply skips once it is
  // gone. Requiring the lock here would only serialize operator unmapping
  // behind in-flight voids and could suppress an admin's remote void in the
  // delete-first interleaving — which is the operator's explicit choice to
  // sever the link, not a race-induced desync.

  try {
    const { before, deletedCount } = await withTransaction(knex, async (trx: Knex.Transaction) => {
      const before = await tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .first();

      if (!before) {
        return { before: null, deletedCount: 0 };
      }

      const deletedCount = await tenantDb(trx, tenant).table<ExternalEntityMapping>('tenant_external_entity_mappings')
        .where({ id: mappingId })
        .del();

      return { before, deletedCount };
    });

    if (!before) {
        logger.warn('External mapping delete requested for unknown id', {
          tenantId: tenant,
          mappingId
        });
        return actionError('Mapping not found. Refresh mappings and try again.', 'msp/integrations:errors.mappings.notFound');
    }

    if (deletedCount === 0) {
      throw new ExpectedExternalMappingError('Unable to delete mapping. Please try again.');
    }

    logger.info('External mapping deleted', { tenantId: tenant, mappingId });

    const actor = user?.user_id
      ? ({ actorType: 'USER', actorUserId: user.user_id } as const)
      : ({ actorType: 'SYSTEM' } as const);

    const changedAt = new Date().toISOString();
    const { payload, idempotencyKey } = buildExternalMappingChangedPublishParams({
      before: before as unknown as TenantExternalEntityMappingRow,
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

    await writeAccountingAudit(knex, tenant, 'accounting_mapping_deleted', {
      userId: user.user_id,
      provider: before.integration_type as AccountingAuditProvider,
      recordId: before.id,
      details: {
        alga_entity_type: before.alga_entity_type,
        alga_entity_id: before.alga_entity_id,
        external_entity_id: before.external_entity_id,
        external_realm_id: before.external_realm_id ?? null,
      },
    }).catch((error) => {
      logger.warn('Failed to write mapping-deleted audit entry', { tenantId: tenant, error });
    });

    return { success: true };
  } catch (error: unknown) {
    logger.error('Failed to delete external entity mapping', {
      tenantId: tenant,
      mappingId,
      error
    });
    if (error instanceof ExpectedExternalMappingError) {
      return actionError(error.message);
    }
    return actionError('Unable to delete mapping. Please try again.', 'msp/integrations:errors.mappings.deleteFailed');
  }
});
