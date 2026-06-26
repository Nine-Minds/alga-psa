'use server';

import { withAuth } from '@alga-psa/auth';
import { hasPermission } from '@alga-psa/auth/rbac';
import { createTenantKnex, tenantDb } from '@alga-psa/db';
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
export const importExternalTaxForInvoice = withAuth(async (
  user,
  { tenant },
  invoiceId: string
): Promise<SingleImportResult> => {
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }
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
  if (!await hasPermission(user, 'billing', 'update')) {
    throw new Error('Permission denied: billing update required');
  }
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
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
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
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
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
  if (!await hasPermission(user, 'billing', 'read')) {
    throw new Error('Permission denied: billing read required');
  }
  const { knex } = await createTenantKnex();
  const facade = tenantDb(knex, tenant);

  const query = facade.table('invoices as i')
    .where({
      'i.tax_source': 'pending_external'
    });
  facade.tenantJoin(query, 'clients as c', 'i.client_id', 'c.client_id');
  facade.tenantJoin(query, 'tenant_external_entity_mappings as m', 'i.invoice_id', 'm.alga_entity_id', {
    type: 'left',
    on: (join) => {
      join.andOnVal('m.alga_entity_type', '=', 'invoice');
    },
  });

  const invoices = await query
    .select(
      'i.invoice_id',
      'i.invoice_number',
      'c.client_name as client_name',
      'i.total_amount',
      'i.created_at',
      'm.integration_type as adapter_type'
    )
    .orderBy('i.created_at', 'desc') as unknown as Array<{
      invoice_id: string;
      invoice_number: string;
      client_name: string;
      total_amount: number;
      created_at: string;
      adapter_type?: string;
    }>;

  return invoices;
});
