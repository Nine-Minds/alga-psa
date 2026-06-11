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
 *
 * Routing by invoice_type:
 *   - 'credit_note'  → export_credit_memo
 *   - 'prepayment'   → skip (prepayments are not exported to QBO)
 *   - else           → export_invoice
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

    // Look up invoice_type to route the operation correctly.
    const invoiceRow = await knex('invoices')
      .where({ invoice_id: invoiceId, tenant: tenantId })
      .select('invoice_type')
      .first();

    const invoiceType: string | null | undefined = invoiceRow?.invoice_type;

    // Prepayments are excluded from QBO export entirely.
    if (invoiceType === 'prepayment') {
      logger.debug('[accountingSync] Skipping prepayment invoice auto-export', { tenantId, invoiceId });
      return;
    }

    const operation = invoiceType === 'credit_note' ? 'export_credit_memo' : 'export_invoice';

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: SYNC_ADAPTER_TYPE,
      targetRealm: realm,
      operation,
      algaEntityType: 'invoice',
      algaEntityId: invoiceId
    });

    logger.debug('[accountingSync] Queued invoice auto-export', { tenantId, invoiceId, realm, operation });
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

/**
 * Enqueue a void_invoice op for the given invoice. Unlike auto-export, this
 * fires regardless of the auto-sync toggle because voids must propagate to
 * keep the books consistent. Only fires when EE + connected realm + mapping.
 */
export async function enqueueInvoiceVoid(
  knex: Knex,
  tenantId: string,
  invoiceId: string
): Promise<void> {
  try {
    if (!isEnterpriseEdition()) {
      return;
    }

    const realm = await getDefaultQboRealmId(tenantId);
    if (!realm) {
      return;
    }

    // Only enqueue when a mapping exists (otherwise there's nothing to void in QBO)
    const mapping = await knex('tenant_external_entity_mappings')
      .where({
        tenant_id: tenantId,
        integration_type: SYNC_ADAPTER_TYPE,
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId
      })
      .first('id');

    if (!mapping) {
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: SYNC_ADAPTER_TYPE,
      targetRealm: realm,
      operation: 'void_invoice',
      algaEntityType: 'invoice',
      algaEntityId: invoiceId
    });

    logger.debug('[accountingSync] Queued invoice void', { tenantId, invoiceId, realm });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue invoice void (void action unaffected)', {
      tenantId,
      invoiceId,
      error: error instanceof Error ? error.message : error
    });
  }
}

/**
 * Enqueue an apply_credit op for the given credit allocation. This is called
 * fire-and-forget after applyCreditToInvoice commits. The op stays pending
 * until both the credit-note invoice and the target invoice are mapped in QBO,
 * at which point the creditApplicationApplier drains it.
 */
export async function enqueueCreditApplication(
  knex: Knex,
  tenantId: string,
  params: {
    allocationId: string;
    creditNoteInvoiceId: string;
    targetInvoiceId: string;
    amountCents: number;
  }
): Promise<void> {
  try {
    if (!isEnterpriseEdition()) {
      return;
    }

    const settings = await getAccountingSyncSettings(knex, tenantId);
    if (!settings.autoSyncEnabled) {
      return;
    }

    const realm = await getDefaultQboRealmId(tenantId);
    if (!realm) {
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: SYNC_ADAPTER_TYPE,
      targetRealm: realm,
      operation: 'apply_credit',
      algaEntityType: 'credit_allocation',
      algaEntityId: params.allocationId,
      payload: {
        creditNoteInvoiceId: params.creditNoteInvoiceId,
        targetInvoiceId: params.targetInvoiceId,
        amountCents: params.amountCents
      }
    });

    logger.debug('[accountingSync] Queued credit application', {
      tenantId,
      allocationId: params.allocationId,
      creditNoteInvoiceId: params.creditNoteInvoiceId,
      targetInvoiceId: params.targetInvoiceId,
      realm
    });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue credit application (apply unaffected)', {
      tenantId,
      allocationId: params.allocationId,
      error: error instanceof Error ? error.message : error
    });
  }
}
