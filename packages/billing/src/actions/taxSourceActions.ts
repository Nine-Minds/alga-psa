'use server';

import { createTenantKnex } from '@alga-psa/db';
import type { TaxSource } from '@alga-psa/types';
import { getTaxImportState } from '@alga-psa/types';
import { withAuth } from '@alga-psa/auth';

/**
 * Client-specific tax source resolution result.
 * Note: The accounting adapter is determined automatically based on which system
 * the invoice is exported to (from tenant_external_entity_mappings), not configured here.
 */
export interface ClientTaxSourceInfo {
  taxSource: TaxSource;
  isOverride: boolean;
}

/**
 * Get the effective tax source for a client.
 * Checks client override first, then falls back to tenant settings.
 * Note: The adapter is NOT returned here - it's determined at export time
 * based on which accounting system the invoice is exported to.
 */
export const getEffectiveTaxSourceForClient = withAuth(async (
  _user,
  { tenant },
  clientId: string
): Promise<ClientTaxSourceInfo> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return {
      taxSource: 'internal',
      isOverride: false
    };
  }

  // First check if the client has an override
  const clientSettings = await knex('client_tax_settings')
    .where({ client_id: clientId, tenant })
    .select('tax_source_override')
    .first();

  if (clientSettings?.tax_source_override) {
    return {
      taxSource: clientSettings.tax_source_override as TaxSource,
      isOverride: true
    };
  }

  // Fall back to tenant settings
  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .select('default_tax_source', 'allow_external_tax_override')
    .first();

  return {
    taxSource: (tenantSettings?.default_tax_source as TaxSource) || 'internal',
    isOverride: false
  };
});

/**
 * Determine if an invoice should use external tax delegation.
 * This should be called during invoice creation to set the initial tax_source.
 */
export const shouldUseTaxDelegation = withAuth(async (_user, ctx, clientId: string): Promise<boolean> => {
  const { taxSource } = await getEffectiveTaxSourceForClient(clientId);
  return taxSource === 'external';
});

/**
 * Get the initial tax_source value for a new invoice based on client settings.
 * Returns 'pending_external' for external delegation, 'internal' otherwise.
 */
export const getInitialInvoiceTaxSource = withAuth(async (_user, ctx, clientId: string): Promise<TaxSource> => {
  const { taxSource } = await getEffectiveTaxSourceForClient(clientId);

  // If client uses external tax, new invoices start as 'pending_external'
  if (taxSource === 'external') {
    return 'pending_external';
  }

  return 'internal';
});

/**
 * Validate that an invoice can be finalized based on its tax source.
 * Returns an error message if finalization should be blocked.
 */
export const validateInvoiceFinalization = withAuth(async (
  _user,
  { tenant },
  invoiceId: string
): Promise<{ canFinalize: boolean; error?: string; warning?: string }> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return { canFinalize: false, error: 'No tenant context' };
  }

  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .select('tax_source', 'status')
    .first();

  if (!invoice) {
    return { canFinalize: false, error: 'Invoice not found' };
  }

  if (invoice.status === 'finalized' || invoice.status === 'paid') {
    return { canFinalize: false, error: 'Invoice is already finalized' };
  }

  // Check if invoice has pending external tax
  if (getTaxImportState(invoice.tax_source as TaxSource) === 'pending') {
    return {
      canFinalize: false,
      error: 'Cannot finalize invoice with pending external tax. Please import tax from the accounting system first.',
      warning: 'Invoice has external tax delegation enabled but tax has not been imported yet.'
    };
  }

  return { canFinalize: true };
});

/**
 * Update an invoice's tax source.
 * Use this when changing from internal to external or vice versa on a draft invoice.
 */
export const updateInvoiceTaxSource = withAuth(async (
  _user,
  { tenant },
  invoiceId: string,
  newTaxSource: TaxSource
): Promise<{ success: boolean; error?: string }> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return { success: false, error: 'No tenant context' };
  }

  const invoice = await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .select('status', 'tax_source')
    .first();

  if (!invoice) {
    return { success: false, error: 'Invoice not found' };
  }

  if (invoice.status !== 'draft') {
    return { success: false, error: 'Can only change tax source on draft invoices' };
  }

  // If changing from external/pending_external to internal, clear external tax data
  if (
    (invoice.tax_source === 'external' || invoice.tax_source === 'pending_external') &&
    newTaxSource === 'internal'
  ) {
    await knex('invoice_charges')
      .where({ invoice_id: invoiceId, tenant })
      .update({
        external_tax_amount: null,
        external_tax_code: null,
        external_tax_rate: null,
        updated_at: knex.fn.now()
      });
  }

  await knex('invoices')
    .where({ invoice_id: invoiceId, tenant })
    .update({
      tax_source: newTaxSource,
      updated_at: knex.fn.now()
    });

  return { success: true };
});

/**
 * Check if client is allowed to override tax source.
 * This is controlled by the tenant setting allow_external_tax_override.
 */
export const canClientOverrideTaxSource = withAuth(async (_user, { tenant }): Promise<boolean> => {
  const { knex } = await createTenantKnex();

  if (!tenant) {
    return false;
  }

  const tenantSettings = await knex('tenant_settings')
    .where({ tenant })
    .select('allow_external_tax_override')
    .first();

  return Boolean(tenantSettings?.allow_external_tax_override);
});
