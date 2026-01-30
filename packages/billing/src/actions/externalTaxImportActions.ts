'use server';

import { withAuth } from '@alga-psa/auth';
import { createTenantKnex } from '@alga-psa/db';
import {
  getExternalTaxImportService,
  SingleImportResult,
  BatchImportResult,
  ReconciliationResult
} from 'server/src/lib/services/externalTaxImportService';
import type { IExternalTaxImport } from '@alga-psa/types';

/**
 * Import external tax for a single invoice.
 * POST /api/invoices/{id}/import-external-tax
 */
export const importExternalTaxForInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<SingleImportResult> => {
  const service = getExternalTaxImportService();
  return service.importTaxForInvoice(invoiceId, user.user_id);
});

/**
 * Batch import taxes for all pending invoices.
 * POST /api/invoices/batch-import-external-tax
 */
export const batchImportExternalTaxes = withAuth(async (
  user,
  { tenant }
): Promise<BatchImportResult> => {
  const service = getExternalTaxImportService();
  return service.batchImportPendingTaxes(user.user_id);
});

/**
 * Get import history for an invoice.
 * GET /api/invoices/{id}/external-tax-history
 */
export const getExternalTaxImportHistory = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<IExternalTaxImport[]> => {
  const service = getExternalTaxImportService();
  return service.getImportHistory(invoiceId);
});

/**
 * Get tax reconciliation details for an invoice.
 */
export const getInvoiceTaxReconciliation = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<ReconciliationResult | null> => {
  const service = getExternalTaxImportService();
  return service.reconcileTaxDifferences(invoiceId);
});

/**
 * Get count of invoices pending external tax import.
 */
export const getPendingExternalTaxCount = withAuth(async (
  user,
  { tenant }
): Promise<number> => {
  const service = getExternalTaxImportService();
  return service.getPendingImportCount();
});

/**
 * Get invoices pending external tax import with details.
 */
export const getInvoicesPendingExternalTax = withAuth(async (
  user,
  { tenant }
): Promise<
  Array<{
    invoice_id: string;
    invoice_number: string;
    client_name: string;
    total_amount: number;
    created_at: string;
    adapter_type?: string;
  }>
> => {
  const { knex } = await createTenantKnex();

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
});
