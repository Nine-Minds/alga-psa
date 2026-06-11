import logger from '@alga-psa/core/logger';
import type { AccountingExternalChange } from '@alga-psa/types';
import { SyncMappingLedger } from './syncMappingLedger';
import type { AccountingSyncCycleStats } from './accountingSync.types';
import type { SyncExceptionService } from './syncExceptions.types';

/**
 * Applies external Customer changes. Linkage is by id, so renames just
 * refresh the mapping's cached display name; a mapped customer that was
 * deleted/merged/made-inactive needs a human to re-link and becomes an
 * exception. Alga clients are never created from external customers.
 */

export interface CustomerApplierDeps {
  tenantId: string;
  targetRealm: string;
  ledger: SyncMappingLedger;
  exceptions: SyncExceptionService;
  stats: AccountingSyncCycleStats;
}

export async function applyExternalCustomerChange(
  deps: CustomerApplierDeps,
  change: AccountingExternalChange
): Promise<void> {
  const mapping = await deps.ledger.findByExternalId('client', change.externalId, deps.targetRealm);
  if (!mapping) {
    return; // Customers we never linked are none of our business.
  }

  const payload = change.payload as Record<string, any> | undefined;
  const inactive = payload?.Active === false;

  if (change.deleted || inactive) {
    const result = await deps.exceptions.createOrUpdate({
      type: 'accounting_sync_customer_unlinked',
      entityType: 'client',
      entityId: mapping.alga_entity_id,
      title: 'Linked QuickBooks customer is no longer available',
      context: {
        alga_client_id: mapping.alga_entity_id,
        external_customer_id: change.externalId,
        display_name: mapping.metadata?.display_name ?? null,
        reason: change.deleted ? 'deleted' : 'inactive',
        realm: deps.targetRealm
      }
    });
    if (result.created) {
      deps.stats.exceptionsCreated += 1;
    }
    return;
  }

  const displayName = typeof payload?.DisplayName === 'string' ? payload.DisplayName : null;
  if (displayName && displayName !== mapping.metadata?.display_name) {
    await deps.ledger.update(mapping.id, {
      metadata: { ...(mapping.metadata ?? {}), display_name: displayName },
      touchSyncedAt: true
    });
    deps.stats.customersUpdated += 1;
    logger.debug('[accountingSync] Refreshed mapped customer display name', {
      tenantId: deps.tenantId,
      clientId: mapping.alga_entity_id,
      displayName
    });
  }
}
