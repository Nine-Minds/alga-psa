'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, withTransaction } from '@alga-psa/db';
import { permissionError, type ActionPermissionError } from '@alga-psa/ui/lib/errorHandling';
import { AUTOMATIC_DISCOUNT_MAPPING_ID, DISCOUNT_MAPPING_ENTITY_TYPE } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import { resolveMappingAdapterType } from '../adapters/accounting/mappingAdapterType';
import {
  QUICKBOOKS_FILE_ADAPTERS,
  collectUnmappedQuickBooksEntities,
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
  const { knex } = await createTenantKnex();
  await withTransaction(knex, async (trx) => {
    const ledger = new SyncMappingLedger(trx, tenant, resolveMappingAdapterType(batch.adapter_type));
    for (const decision of decisions) {
      const isDiscount = decision.algaEntityType === 'discount';
      await ledger.insert({
        algaEntityType: isDiscount ? DISCOUNT_MAPPING_ENTITY_TYPE : decision.algaEntityType,
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

  logger.info('[quickBooksExportMappingActions] Saved mappings from export prompt', {
    tenant,
    batchId,
    adapterType: batch.adapter_type,
    created: decisions.filter((d) => d.mode === 'create').length,
    linked: decisions.filter((d) => d.mode === 'existing').length
  });

  return { saved: decisions.length };
});
