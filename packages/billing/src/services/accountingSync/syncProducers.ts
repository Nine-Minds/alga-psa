/* eslint-disable custom-rules/no-feature-to-feature-imports -- producers consult the QBO connection state to decide whether to enqueue */
import { Knex } from 'knex';
import { tenantDb } from '@alga-psa/db';
import logger from '@alga-psa/core/logger';
import { getAccountingSyncSettings } from './accountingSyncSettings';
import { resolveDefaultRealm } from './accountingSyncSettings';
import { SyncOperationsRepository } from './syncOperationsRepository';
import { ADAPTER_EXPORT_CAPABILITIES } from '../../adapters/accounting/registry';
import { resolveConnectedAccountingIntegration } from './connectedAccountingIntegration';

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

const QBO_ADAPTER_TYPE = 'quickbooks_online';

function adapterSupportsExportType(adapterType: string, exportType: string): boolean {
  const capabilities = ADAPTER_EXPORT_CAPABILITIES as Record<string, readonly string[] | undefined>;
  return Boolean(capabilities[adapterType]?.includes(exportType));
}

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

    const integration = await resolveConnectedAccountingIntegration(knex, tenantId);
    if (!integration) {
      return;
    }

    // Look up invoice_type to route the operation correctly.
    const invoiceRow = await tenantDb(knex, tenantId).table('invoices')
      .where({ invoice_id: invoiceId })
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
      adapterType: integration.adapterType,
      targetRealm: integration.targetRealm,
      operation,
      algaEntityType: 'invoice',
      algaEntityId: invoiceId
    });

    logger.debug('[accountingSync] Queued invoice auto-export', {
      tenantId,
      invoiceId,
      adapterType: integration.adapterType,
      targetRealm: integration.targetRealm,
      operation
    });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue invoice auto-export (finalize unaffected)', {
      tenantId,
      invoiceId,
      error: error instanceof Error ? error.message : error
    });
  }
}

async function enqueueVendorBillExportOperation(
  knex: Knex,
  tenantId: string,
  billId: string,
  options: { requireAutoSync: boolean }
): Promise<boolean> {
  if (!isEnterpriseEdition()) {
    return false;
  }

  const settings = await getAccountingSyncSettings(knex, tenantId);
  if (options.requireAutoSync && !settings.autoSyncEnabled) {
    return false;
  }

  if (options.requireAutoSync && settings.autoSyncStartDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (today < settings.autoSyncStartDate.slice(0, 10)) {
      return false;
    }
  }

  const integration = await resolveConnectedAccountingIntegration(knex, tenantId);
  if (!integration) {
    return false;
  }

  if (!adapterSupportsExportType(integration.adapterType, 'vendor_bill')) {
    return false;
  }

  await new SyncOperationsRepository(knex).enqueue({
    tenant: tenantId,
    adapterType: integration.adapterType,
    targetRealm: integration.targetRealm,
    operation: 'export_vendor_bill',
    algaEntityType: 'vendor_bill',
    algaEntityId: billId
  });

  logger.debug('[accountingSync] Queued vendor bill export', {
    tenantId,
    billId,
    adapterType: integration.adapterType,
    targetRealm: integration.targetRealm,
    requireAutoSync: options.requireAutoSync
  });

  return true;
}

/**
 * Auto-export on vendor bill open: enqueue for the next sync cycle when the
 * tenant has a connected accounting integration that supports vendor bills.
 */
export async function enqueueVendorBillAutoExport(
  knex: Knex,
  tenantId: string,
  billId: string
): Promise<void> {
  try {
    await enqueueVendorBillExportOperation(knex, tenantId, billId, { requireAutoSync: true });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue vendor bill auto-export (status change unaffected)', {
      tenantId,
      billId,
      error: error instanceof Error ? error.message : error
    });
  }
}

/**
 * Explicit retry from the UI. This intentionally bypasses the auto-sync toggle
 * because the operator is making a direct retry decision.
 */
export async function enqueueVendorBillExportRetry(
  knex: Knex,
  tenantId: string,
  billId: string
): Promise<boolean> {
  return enqueueVendorBillExportOperation(knex, tenantId, billId, { requireAutoSync: false });
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
    if (invoiceIds.length === 0) {
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

    const realm = await resolveDefaultRealm(knex, tenantId);
    if (!realm) {
      return;
    }

    // Only enqueue when a mapping exists (otherwise there's nothing to void in QBO)
    const mapping = await tenantDb(knex, tenantId).table('tenant_external_entity_mappings')
      .where({
        integration_type: QBO_ADAPTER_TYPE,
        alga_entity_type: 'invoice',
        alga_entity_id: invoiceId
      })
      .first('id');

    if (!mapping) {
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: QBO_ADAPTER_TYPE,
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
 * Enqueue a record_payment op to push an Alga-originated payment (e.g. Stripe)
 * to QBO as a Payment object. Called fire-and-forget from the recordExternalPayment
 * success path; must never throw into the payment action.
 *
 * Guards (all must pass to enqueue):
 *   - Enterprise Edition only
 *   - provider must NOT be 'quickbooks' (echo guard — QBO-pulled payments must
 *     not be pushed back)
 *   - A realm must be connected
 *   - The invoice must already have a 'quickbooks_online' invoice mapping (invoices
 *     predating go-live are silently skipped, NOT an exception)
 */
export async function enqueueExternalPaymentPush(
  knex: Knex,
  tenantId: string,
  params: {
    invoiceId: string;
    paymentId: string;
    amountCents: number;
    provider: string;
    referenceNumber: string;
  }
): Promise<void> {
  try {
    // Echo guard: never push back payments that originated from QBO.
    if (params.provider === 'quickbooks') {
      return;
    }

    if (!isEnterpriseEdition()) {
      return;
    }

    const realm = await resolveDefaultRealm(knex, tenantId);
    if (!realm) {
      return;
    }

    // Skip invoices that don't have a QBO mapping yet (pre-go-live invoices).
    const mapping = await tenantDb(knex, tenantId).table('tenant_external_entity_mappings')
      .where({
        integration_type: QBO_ADAPTER_TYPE,
        alga_entity_type: 'invoice',
        alga_entity_id: params.invoiceId
      })
      .first('id');

    if (!mapping) {
      logger.debug('[accountingSync] Skipping payment push — invoice has no QBO mapping (pre-go-live)', {
        tenantId,
        invoiceId: params.invoiceId,
        paymentId: params.paymentId
      });
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: QBO_ADAPTER_TYPE,
      targetRealm: realm,
      operation: 'record_payment',
      algaEntityType: 'invoice_payment',
      algaEntityId: params.paymentId,
      payload: {
        invoiceId: params.invoiceId,
        amountCents: params.amountCents,
        referenceNumber: params.referenceNumber,
        provider: params.provider
      }
    });

    logger.debug('[accountingSync] Queued payment push to QBO', {
      tenantId,
      invoiceId: params.invoiceId,
      paymentId: params.paymentId,
      realm
    });
  } catch (error) {
    logger.warn('[accountingSync] Failed to queue payment push (payment action unaffected)', {
      tenantId,
      paymentId: params.paymentId,
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

    const realm = await resolveDefaultRealm(knex, tenantId);
    if (!realm) {
      return;
    }

    await new SyncOperationsRepository(knex).enqueue({
      tenant: tenantId,
      adapterType: QBO_ADAPTER_TYPE,
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
