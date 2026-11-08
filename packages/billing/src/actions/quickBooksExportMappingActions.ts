'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb, withTransaction } from '@alga-psa/db';
import {
  actionError,
  permissionError,
  type ActionMessageError,
  type ActionPermissionError
} from '@alga-psa/ui/lib/errorHandling';
import { AUTOMATIC_DISCOUNT_MAPPING_ID, DISCOUNT_MAPPING_ENTITY_TYPE } from '@alga-psa/types';
import logger from '@alga-psa/core/logger';
import { AccountingExportRepository } from '../repositories/accountingExportRepository';
import { SyncMappingLedger } from '../services/accountingSync/syncMappingLedger';
import {
  QUICKBOOKS_FILE_ADAPTERS,
  collectUnmappedQuickBooksEntities,
  findQuickBooksNameConflict,
  validateQuickBooksMappingDecisions,
  type QuickBooksMappingDecision,
  type QuickBooksMappingProblem,
  type UnmappedQuickBooksEntity
} from './quickBooksExportMappingRules';

const toActionError = (problem: QuickBooksMappingProblem): ActionMessageError =>
  actionError(problem.message, `msp/billing:${problem.key}`, problem.params);

const unsupportedBatch = (): ActionMessageError =>
  actionError(
    'This batch is not a QuickBooks Desktop or QuickBooks CSV export.',
    'msp/billing:errors.accountingExport.quickbooksMapping.unsupportedBatch'
  );

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
): Promise<UnmappedQuickBooksEntity[] | ActionPermissionError | ActionMessageError> => {
  const denied = await checkPermissions(user);
  if (denied) return denied;

  const repo = await AccountingExportRepository.create();
  const batch = await repo.getBatch(batchId);
  if (!batch || !QUICKBOOKS_FILE_ADAPTERS.includes(batch.adapter_type)) {
    return unsupportedBatch();
  }
  const errors = await repo.listErrors(batchId);
  return collectUnmappedQuickBooksEntities(batch.adapter_type, errors);
});

/**
 * Save the user's decision for each unmapped entity as a mapping of the
 * batch's own integration type, so later exports never ask again. On a Desktop
 * batch a service/discount decision names the QuickBooks item (metadata.qbdItem)
 * while the mapping's value stays the income account it posts to; an existing
 * account-only Desktop mapping is completed in place. "create" on a Desktop
 * batch also tags the mapping with the batch id so that batch's IIF file
 * defines the new customer/item before using it.
 */
export const saveQuickBooksExportMappings = withAuth(async (
  user,
  { tenant },
  batchId: string,
  decisions: QuickBooksMappingDecision[]
): Promise<{ saved: number } | ActionPermissionError | ActionMessageError> => {
  const denied = await checkPermissions(user);
  if (denied) return denied;

  const repo = await AccountingExportRepository.create();
  const batch = await repo.getBatch(batchId);
  if (!batch || !QUICKBOOKS_FILE_ADAPTERS.includes(batch.adapter_type)) {
    return unsupportedBatch();
  }

  const pending = collectUnmappedQuickBooksEntities(batch.adapter_type, await repo.listErrors(batchId));
  const problem = validateQuickBooksMappingDecisions(batch.adapter_type, pending, decisions);
  if (problem) {
    return toActionError(problem);
  }

  const isDesktop = batch.adapter_type === 'quickbooks_desktop';
  const integrationType = batch.adapter_type;
  const storedEntityType = (type: QuickBooksMappingDecision['algaEntityType']) =>
    type === 'discount' ? DISCOUNT_MAPPING_ENTITY_TYPE : type;
  const pendingByKey = new Map(pending.map((entity) => [`${entity.algaEntityType}:${entity.algaEntityId}`, entity]));
  const isDesktopItem = (decision: QuickBooksMappingDecision) => isDesktop && decision.algaEntityType !== 'client';

  // A new Desktop service/discount mapping needs the income account it posts
  // to: the existing mapping's, else the Desktop default income account.
  let defaultIncomeAccount = '';
  if (decisions.some((decision) => isDesktopItem(decision) && !pendingByKey.get(`${decision.algaEntityType}:${decision.algaEntityId}`)?.desktopAccount)) {
    // Loaded only on this path: the integrations runtime is heavy, and every
    // importer of these actions (the Accounting Exports tab) would otherwise pay for it.
    // eslint-disable-next-line custom-rules/no-feature-to-feature-imports -- the Desktop default income account is integration-owned tenant settings, read the same way accountingExportService reads them
    const { getQuickBooksDesktopSettingsForTenant } = await import('@alga-psa/integrations/runtime');
    defaultIncomeAccount = (await getQuickBooksDesktopSettingsForTenant(tenant)).defaultIncomeAccount;
    if (!defaultIncomeAccount) {
      return actionError(
        'Set the default income account in the QuickBooks Desktop settings before mapping items from an export.',
        'msp/billing:errors.accountingExport.quickbooksMapping.desktopIncomeAccountRequired'
      );
    }
  }

  const { knex } = await createTenantKnex();

  // idx_unique_external_mapping allows one Alga entity per QuickBooks name and
  // entity type among live rows (tombstones, i.e. deleted_at set, are outside the
  // index); check up front for a clear error.
  const existing = await tenantDb(knex, tenant).table('tenant_external_entity_mappings')
    .select('alga_entity_type', 'alga_entity_id', 'external_entity_id')
    .where({ integration_type: integrationType })
    .whereNull('deleted_at')
    .whereIn('alga_entity_type', Array.from(new Set(decisions.map((d) => storedEntityType(d.algaEntityType)))))
    .whereIn('external_entity_id', Array.from(new Set(decisions.map((d) => d.externalName.trim()))))
    .modify((query) => {
      if (batch.target_realm) {
        query.where('external_realm_id', batch.target_realm);
      } else {
        query.whereNull('external_realm_id');
      }
    });
  const conflict = findQuickBooksNameConflict(pending, decisions, existing, storedEntityType, batch.adapter_type);
  if (conflict) {
    return toActionError(conflict);
  }

  try {
    await withTransaction(knex, async (trx) => {
      const ledger = new SyncMappingLedger(trx, tenant, integrationType);
      for (const decision of decisions) {
        const isDiscount = decision.algaEntityType === 'discount';
        const algaEntityId = isDiscount ? AUTOMATIC_DISCOUNT_MAPPING_ID : decision.algaEntityId;
        const name = decision.externalName.trim();
        const entity = pendingByKey.get(`${decision.algaEntityType}:${decision.algaEntityId}`);
        const metadata = {
          linked_via: 'accounting_export',
          export_batch_id: batchId,
          ...(isDesktopItem(decision) ? { qbdItem: name } : {}),
          ...(decision.mode === 'create' ? { createdByExport: true } : {}),
          ...(decision.mode === 'create' && isDesktop ? { qbdCreateInBatch: batchId } : {})
        };

        if (isDesktopItem(decision) && entity?.desktopMappingInPlace) {
          // Keep the account (and any other metadata) the user already set; add the item.
          await tenantDb(trx, tenant).table('tenant_external_entity_mappings')
            .where({
              integration_type: integrationType,
              alga_entity_type: storedEntityType(decision.algaEntityType),
              alga_entity_id: algaEntityId
            })
            .modify((query) => {
              if (batch.target_realm) {
                query.where('external_realm_id', batch.target_realm);
              } else {
                query.whereNull('external_realm_id');
              }
            })
            .update({
              metadata: trx.raw("COALESCE(metadata, '{}'::jsonb) || ?::jsonb", [JSON.stringify(metadata)])
            });
          continue;
        }

        await ledger.insert({
          algaEntityType: storedEntityType(decision.algaEntityType),
          algaEntityId,
          externalEntityId: isDesktopItem(decision) ? (entity?.desktopAccount ?? defaultIncomeAccount) : name,
          targetRealm: batch.target_realm ?? null,
          syncStatus: 'manual_link',
          metadata
        });
      }
    });
  } catch (error) {
    // A concurrent mapping edit can still take a name between the check and the insert.
    if ((error as { code?: string } | null)?.code === '23505') {
      return actionError(
        'One of these QuickBooks names was just mapped to another entry. Refresh the list and choose a different name.',
        'msp/billing:errors.accountingExport.quickbooksMapping.nameTakenConcurrently'
      );
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
