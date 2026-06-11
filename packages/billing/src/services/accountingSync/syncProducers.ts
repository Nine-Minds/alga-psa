/* eslint-disable custom-rules/no-feature-to-feature-imports -- producers consult the QBO connection state to decide whether to enqueue */
import { Knex } from 'knex';
import logger from '@alga-psa/core/logger';
import { getDefaultQboRealmId } from '@alga-psa/integrations/lib/qbo/qboClientService';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';

/**
 * Producers enqueue outbound sync operations from billing events. They are
 * fire-and-forget: a producer failure must never break the originating
 * action (finalize, payment, ...), so everything is caught and logged.
 */

function isEnterpriseEdition(): boolean {
  return (
    (process.env.EDITION ?? '').toLowerCase() === 'ee' ||
    (process.env.NEXT_PUBLIC_EDITION ?? '').toLowerCase() === 'enterprise'
  );
}

const SYNC_ADAPTER_TYPE = 'quickbooks_online';

/**
 * Auto-export on finalize: enqueue the invoice for the next sync cycle when
 * the tenant has a connected realm, auto-sync on, and the invoice is on or
 * after the go-live cutoff.
 */
export async function enqueueInvoiceAutoExport(
  knex: Knex,
  tenantId: string,
  invoiceId: string
): Promise<void> {
  try {
    if (!isEnterpriseEdition()) {
      return;
    }

    const settings = await getAccountingSyncSettings(knex, tenantId);
    if (!settings.autoSyncEnabled) {
      return;
    }

    if (settings.autoSyncStartDate) {
      // Finalization happens "now"; the cutoff fences out re-finalized history.
      const today = new Date().toISOString().slice(0, 10);
      if (today < settings.autoSyncStartDate.slice(0, 10)) {
        return;
      }
    }

    const realm = await getDefaultQboRealmId(tenantId);
    if (!realm) {
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: SYNC_ADAPTER_TYPE,
      targetRealm: realm,
      operation: 'export_invoice',
      algaEntityType: 'invoice',
      algaEntityId: invoiceId
    });

    logger.debug('[accountingSync] Queued invoice auto-export', { tenantId, invoiceId, realm });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue invoice auto-export (finalize unaffected)', {
      tenantId,
      invoiceId,
      error: error instanceof Error ? error.message : error
    });
  }
}

/**
 * Manual batches satisfy queued auto-export ops for the invoices they cover,
 * so manual and scheduled paths never double-export.
 */
export async function satisfyExportOpsForManualBatch(
  knex: Knex,
  tenantId: string,
  adapterType: string,
  invoiceIds: string[]
): Promise<void> {
  try {
    if (adapterType !== SYNC_ADAPTER_TYPE || invoiceIds.length === 0) {
      return;
    }
    const satisfied = await new SyncOperationsRepository(knex).satisfyPending(
      tenantId,
      adapterType,
      'export_invoice',
      invoiceIds
    );
    if (satisfied > 0) {
      logger.debug('[accountingSync] Manual batch satisfied queued export ops', { tenantId, satisfied });
    }
  } catch (error) {
    logger.warn('[accountingSync] Failed to satisfy export ops for manual batch', {
      tenantId,
      error: error instanceof Error ? error.message : error
    });
  }
}
