'use server';

import { getCurrentUserAsync, hasPermissionAsync, getSessionAsync, getAnalyticsAsync } from '../lib/authHelpers';
import {
  getExternalTaxImportService,
  SingleImportResult,
  BatchImportResult,
  ReconciliationResult
} from '../services/externalTaxImportService';
import type { IExternalTaxImport } from '@alga-psa/types';

/**
 * Import external tax for a single invoice.
 * POST /api/invoices/{id}/import-external-tax
 */
export async function importExternalTaxForInvoice(
  invoiceId: string
): Promise<SingleImportResult> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return {
      success: false,
      invoiceId,
      originalTax: 0,
      importedTax: 0,
      difference: 0,
      chargesUpdated: 0,
      error: 'Unauthorized: User not authenticated'
    };
  }

  const service = getExternalTaxImportService();
  return service.importTaxForInvoice(invoiceId, user.user_id);
}

/**
 * Batch import taxes for all pending invoices.
 * POST /api/invoices/batch-import-external-tax
 */
export async function batchImportExternalTaxes(): Promise<BatchImportResult> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return {
      totalProcessed: 0,
      successCount: 0,
      failureCount: 0,
      skippedCount: 0,
      results: [],
      errors: [{ invoiceId: 'N/A', error: 'Unauthorized: User not authenticated' }]
    };
  }

  const service = getExternalTaxImportService();
  return service.batchImportPendingTaxes(user.user_id);
}

/**
 * Get import history for an invoice.
 * GET /api/invoices/{id}/external-tax-history
 */
export async function getExternalTaxImportHistory(
  invoiceId: string
): Promise<IExternalTaxImport[]> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return [];
  }

  const service = getExternalTaxImportService();
  return service.getImportHistory(invoiceId);
}

/**
 * Get tax reconciliation details for an invoice.
 */
export async function getInvoiceTaxReconciliation(
  invoiceId: string
): Promise<ReconciliationResult | null> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return null;
  }

  const service = getExternalTaxImportService();
  return service.reconcileTaxDifferences(invoiceId);
}

/**
 * Get count of invoices pending external tax import.
 */
export async function getPendingExternalTaxCount(): Promise<number> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return 0;
  }

  const service = getExternalTaxImportService();
  return service.getPendingImportCount();
}

/**
 * Get invoices pending external tax import with details.
 */
export async function getInvoicesPendingExternalTax(): Promise<
  Array<{
    invoice_id: string;
    invoice_number: string;
    client_name: string;
    total_amount: number;
    created_at: string;
    adapter_type?: string;
  }>
> {
  const user = await getCurrentUserAsync();
  if (!user) {
    return [];
  }

  // Import createTenantKnex here to avoid circular dependencies
  const { createTenantKnex } = await import('@alga-psa/db');
  const { knex, tenant } = await createTenantKnex();

  if (!tenant) {
    return [];
  }

  const invoices = await knex('invoices as i')
    .join('companies as c', function() {
      this.on('i.client_id', '=', 'c.company_id')
        .andOn('i.tenant', '=', 'c.tenant');
    })
    .leftJoin('tenant_external_entity_mappings as m', function() {
      this.on('i.invoice_id', '=', 'm.alga_entity_id')
        .andOn('i.tenant', '=', 'm.tenant')
        .andOnVal('m.alga_entity_type', '=', 'invoice');
    })
    .where({
      'i.tenant': tenant,
      'i.tax_source': 'pending_external'
    })
    .select(
      'i.invoice_id',
      'i.invoice_number',
      'c.company_name as client_name',
      'i.total_amount',
      'i.created_at',
      'm.integration_type as adapter_type'
    )
    .orderBy('i.created_at', 'desc');

  return invoices;
}
