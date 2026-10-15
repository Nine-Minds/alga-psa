'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AUTOMATIC_DISCOUNT_MAPPING_ID, DISCOUNT_MAPPING_ENTITY_TYPE } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { resolveMappingAdapterType } from '../adapters/accounting/mappingAdapterType';
import {
  QUICKBOOKS_FILE_ADAPTERS,
  collectUnmappedQuickBooksEntities,
  findQuickBooksNameConflict,
  validateQuickBooksMappingDecisions,
  type QuickBooksMappingDecision,
  type UnmappedQuickBooksEntity
} from './quickBooksExportMappingRules';

export interface QuickBooksExportMappingError {
  success: false;
  code: string;
  message: string;
}

async function checkPermissions(user: Parameters<typeof hasPermission>[0]): Promise<ActionPermissionError | null> {
  if ((user as { user_type?: string }).user_type === 'client') {
    return permissionError('Client portal users are not permitted to manage accounting exports', 'msp/billing:errors.accountingExport.clientPortalForbidden');
  }
  const canExport = await hasPermission(user, 'accounting_integrations', 'exports_execute');
  const canMap = await hasPermission(user, 'accounting_integrations', 'mappings_manage');
  if (!canExport || !canMap) {
    return permissionError(
      'Creating QuickBooks mappings from an export requires the export and manage-mappings capabilities',
      'msp/billing:errors.accountingExport.permissions.createMappings'
    );
  }
  return null;
}

/**
 * Unmapped clients, services/products and discounts that block a QuickBooks
 * Desktop or QuickBooks CSV batch, with a proposed QuickBooks name for each.
 */
export const getUnmappedQuickBooksEntities = withAuth(async (
  user,
  _ctx,
  batchId: string
): Promise<UnmappedQuickBooksEntity[] | ActionPermissionError | QuickBooksExportMappingError> => {
  const denied = await checkPermissions(user);
  if (denied) return denied;

  const repo = await AccountingExportRepository.create();
  const batch = await repo.getBatch(batchId);
  if (!batch || !QUICKBOOKS_FILE_ADAPTERS.includes(batch.adapter_type)) {
    return { success: false, code: 'QB_EXPORT_MAPPING_UNSUPPORTED', message: 'This batch is not a QuickBooks Desktop or QuickBooks CSV export.' };
  }
  const errors = await repo.listErrors(batchId);
  return collectUnmappedQuickBooksEntities(batch.adapter_type, errors);
});

/**
 * Save the user's decision for each unmapped entity as a QuickBooks CSV
 * mapping (shared with QuickBooks Desktop), so later exports never ask again.
 * "create" on a Desktop batch also tags the mapping with the batch id so that
 * batch's IIF file defines the new customer/item before using it.
 */
export const saveQuickBooksExportMappings = withAuth(async (
  user,
  { tenant },
  batchId: string,
  decisions: QuickBooksMappingDecision[]
): Promise<{ saved: number } | ActionPermissionError | QuickBooksExportMappingError> => {
  const denied = await checkPermissions(user);
  if (denied) return denied;

  const repo = await AccountingExportRepository.create();
  const batch = await repo.getBatch(batchId);
  if (!batch || !QUICKBOOKS_FILE_ADAPTERS.includes(batch.adapter_type)) {
    return { success: false, code: 'QB_EXPORT_MAPPING_UNSUPPORTED', message: 'This batch is not a QuickBooks Desktop or QuickBooks CSV export.' };
  }

  const pending = collectUnmappedQuickBooksEntities(batch.adapter_type, await repo.listErrors(batchId));
  const problem = validateQuickBooksMappingDecisions(batch.adapter_type, pending, decisions);
  if (problem) {
    return { success: false, code: 'QB_EXPORT_MAPPING_INVALID', message: problem };
  }

  const isDesktop = batch.adapter_type === 'quickbooks_desktop';
  const integrationType = resolveMappingAdapterType(batch.adapter_type);
  const storedEntityType = (type: QuickBooksMappingDecision['algaEntityType']) =>
    type === 'discount' ? DISCOUNT_MAPPING_ENTITY_TYPE : type;
  const { knex } = await createTenantKnex();

  // idx_unique_external_mapping allows one Alga entity per QuickBooks name and
  // entity type, and covers unlinked rows too; check up front for a clear error.
  const existing = await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
    .select('alga_entity_type', 'alga_entity_id', 'external_entity_id')
    .where({ integration_type: integrationType })
    .whereIn('alga_entity_type', Array.from(new Set(decisions.map((d) => storedEntityType(d.algaEntityType)))))
    .whereIn('external_entity_id', Array.from(new Set(decisions.map((d) => d.externalName.trim()))))
    .modify((query) => {
      if (batch.target_realm) {
        query.where('external_realm_id', batch.target_realm);
      } else {
        query.whereNull('external_realm_id');
      }
    });
  const conflict = findQuickBooksNameConflict(pending, decisions, existing, storedEntityType);
  if (conflict) {
    return { success: false, code: 'QB_EXPORT_MAPPING_NAME_TAKEN', message: conflict };
  }

  try {
    await withTransaction(knex, async (trx) => {
      const ledger = new SyncMappingLedger(trx, tenant, integrationType);
      for (const decision of decisions) {
        const isDiscount = decision.algaEntityType === 'discount';
        await ledger.insert({
          algaEntityType: storedEntityType(decision.algaEntityType),
          algaEntityId: isDiscount ? AUTOMATIC_DISCOUNT_MAPPING_ID : decision.algaEntityId,
          externalEntityId: decision.externalName.trim(),
          targetRealm: batch.target_realm ?? null,
          syncStatus: 'manual_link',
          metadata: {
            linked_via: 'accounting_export',
            export_batch_id: batchId,
            ...(decision.mode === 'create' ? { createdByExport: true } : {}),
            ...(decision.mode === 'create' && isDesktop ? { qbdCreateInBatch: batchId } : {})
          }
        });
      }
    });
  } catch (error) {
    // A concurrent mapping edit can still take a name between the check and the insert.
    if ((error as { code?: string } | null)?.code === '23505') {
      return {
        success: false,
        code: 'QB_EXPORT_MAPPING_NAME_TAKEN',
        message: 'One of these QuickBooks names was just mapped to another entry. Refresh the list and choose a different name.'
      };
    }
    throw error;
  }

  logger.info('[quickBooksExportMappingActions] Saved mappings from export prompt', {
    tenant,
    batchId,
    adapterType: batch.adapter_type,
    created: decisions.filter((d) => d.mode === 'create').length,
    linked: decisions.filter((d) => d.mode === 'existing').length
  });

  return { saved: decisions.length };
});
